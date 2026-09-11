import { z } from 'zod'
import { GoogleAiError, parseRetryAfter } from '@/modules/google-ai-studio/lib/gemini'

// ---------------------------------------------------------------------------
// Google AI Studio's generateContent API, the part of it that writes words.
//
// A separate endpoint and a separate model from the picture-making next door in
// gemini.ts, which is why it is a separate file rather than a third argument to
// that one: nothing is shared but the key, the error class and the way a
// Retry-After header is read.
//
// One call, several drafts. The model is asked for a JSON array and pinned to
// it with a response schema, so what comes back is parsed rather than picked
// apart - a model asked politely for "three replies, numbered" will one day
// hand back two, or four, or a preamble explaining what it has done.
// ---------------------------------------------------------------------------

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models'

// Every module API route shares one 60-second ceiling on the dispatcher, so the
// call has to give up before the platform does. Words come back faster than
// pictures, and somebody is watching a button spin.
const TIMEOUT_MS = 30_000

/** Longest a single draft may be. A reply that runs past this is not a reply,
 *  it is an essay, and it would be rewritten before it went anywhere. */
const MAX_DRAFT_CHARS = 4_000

const ResponseBody = z.object({
  candidates: z.array(z.object({
    content: z.object({
      parts: z.array(z.object({
        text: z.string().optional(),
        // A thinking model may hand back its reasoning as a part of its own.
        // It is not the answer and must never be concatenated onto it.
        thought: z.boolean().optional(),
      }).passthrough()).optional(),
    }).optional(),
    finishReason: z.string().optional(),
  })).optional(),
  promptFeedback: z.object({ blockReason: z.string().optional() }).optional(),
})

const ErrorBody = z.object({
  error: z.object({ message: z.string().optional(), status: z.string().optional() }).optional(),
})

/** What the model is pinned to: a bare array of strings, nothing else. */
const DraftsBody = z.array(z.string())

/** Plain English for the handful of failures an owner can actually do something
 *  about. Same list as the picture side, worded for words. */
function describeHttpFailure(httpStatus: number, message: string | undefined, retryAfter: number | null): GoogleAiError {
  if (httpStatus === 400 && message) return new GoogleAiError(`Google would not accept that request: ${message}`, 400)
  if (httpStatus === 401 || httpStatus === 403) {
    return new GoogleAiError('Google refused that API key. Check it on the Google AI Studio settings tab.', 401)
  }
  if (httpStatus === 404) {
    return new GoogleAiError('Google does not know that writing model. Pick one from the list on the Google AI Studio settings tab.', 404)
  }
  if (httpStatus === 429) {
    return new GoogleAiError('Google is rate limiting this key at the moment.', 429, retryAfter)
  }
  if (httpStatus === 503) {
    // Not the key, not the request, not the site: that particular model has
    // more people asking than it can answer. Newly named models do this for
    // weeks, which is worth saying, because the fix is to pick another one.
    return new GoogleAiError(
      'That writing model is too busy at Google just now. Try again in a moment, or choose a different one on the Google AI Studio settings tab.',
      503,
    )
  }
  return new GoogleAiError(message ? `Google said: ${message}` : `Google returned an error (${httpStatus}).`)
}

/**
 * Every ANSWER part of the first candidate, joined.
 *
 * Structured output arrives in one part in practice and is allowed by the API
 * to arrive in several, hence the join. `thought` parts are dropped rather than
 * joined: the models worth using here all think before they answer - a verified
 * call spent a thousand tokens doing it - and a reasoning part concatenated
 * onto the JSON would fail to parse and be served to somebody as a draft.
 */
export function answerText(parts: Array<{ text?: string, thought?: boolean }>): string | null {
  const text = parts
    .filter((part) => part.thought !== true)
    .map((part) => part.text ?? '')
    .join('')
    .trim()
  return text.length > 0 ? text : null
}

function firstText(body: z.infer<typeof ResponseBody>): string | null {
  return answerText(body.candidates?.[0]?.content?.parts ?? [])
}

export type GenerateDraftsInput = {
  apiKey: string
  model: string
  /** Everything the model is to work from: the house style, the conversation,
   *  and what it is being asked for. Built by lib/reply-prompt.ts. */
  prompt: string
  /** How many drafts to ask for. */
  count: number
}

/**
 * A few drafts, as plain words. Throws {@link GoogleAiError} with something
 * worth reading.
 */
export async function generateDrafts(input: GenerateDraftsInput): Promise<string[]> {
  const body = {
    contents: [{ role: 'user', parts: [{ text: input.prompt }] }],
    generationConfig: {
      // Structured output. The schema is what stops a model answering "Certainly!
      // Here are three replies:" and leaving whoever asked to parse prose.
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'ARRAY',
        minItems: input.count,
        maxItems: input.count,
        items: { type: 'STRING' },
      },
      // Drafts that are three wordings of the same sentence are two wasted
      // choices, so this is warmer than anything factual would want.
      temperature: 0.9,
    },
  }

  let response: Response
  try {
    response = await fetch(`${ENDPOINT}/${encodeURIComponent(input.model)}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': input.apiKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (error) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      throw new GoogleAiError('Google took too long to answer. Try again in a moment.', 504)
    }
    throw new GoogleAiError('Could not reach Google AI Studio.')
  }

  const text = await response.text()
  let json: unknown = null
  try {
    json = text ? JSON.parse(text) as unknown : null
  } catch {
    throw new GoogleAiError('Google answered with something this module could not read.')
  }

  if (!response.ok) {
    const parsed = ErrorBody.safeParse(json)
    throw describeHttpFailure(
      response.status,
      parsed.success ? parsed.data.error?.message : undefined,
      parseRetryAfter(response.headers.get('retry-after')),
    )
  }

  const parsed = ResponseBody.safeParse(json)
  if (!parsed.success) throw new GoogleAiError('Google answered with something this module could not read.')

  // A refusal is a perfectly good response with nothing in it, and it is the
  // one failure whoever asked can actually do something about.
  if (parsed.data.promptFeedback?.blockReason) {
    throw new GoogleAiError('Google would not write anything for that conversation.', 422)
  }

  const payload = firstText(parsed.data)
  if (!payload) throw new GoogleAiError('Google wrote nothing at all. Try again in a moment.', 422)

  let drafts: unknown
  try {
    drafts = JSON.parse(payload) as unknown
  } catch {
    // The schema above makes this unlikely rather than impossible, and a model
    // that has ignored it has not written three drafts - it has written one
    // thing, and offering it as "suggestion 1 of 1" is a better answer than an
    // error.
    return [payload.slice(0, MAX_DRAFT_CHARS)]
  }

  const checked = DraftsBody.safeParse(drafts)
  if (!checked.success) throw new GoogleAiError('Google answered with something this module could not read.')

  return checked.data
    .map((draft) => draft.trim())
    .filter((draft) => draft.length > 0)
    .map((draft) => draft.slice(0, MAX_DRAFT_CHARS))
}
