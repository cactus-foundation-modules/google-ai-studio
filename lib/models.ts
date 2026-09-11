import { z } from 'zod'
import { GoogleAiError, parseRetryAfter } from '@/modules/google-ai-studio/lib/gemini'

// ---------------------------------------------------------------------------
// What models this key can actually use, asked of Google rather than guessed.
//
// Both model settings began life as free text boxes, on the reasoning that
// Google names a new model every few months and no site should have to wait for
// a module release to type it in. That reasoning still holds; what it missed is
// that a typed name is a guess, and a wrong guess comes back as a 404 an hour
// after somebody set it up. The module's own default was wrong on the day it
// was written - there is no `gemini-3.1-flash`, only `-image` and `-lite` at
// that generation - which is the same mistake from the other end.
//
// So the settings screen offers the list and keeps the box. Google is the only
// authority on what exists; the box is what stops this module standing between
// an owner and a model Google named this morning.
// ---------------------------------------------------------------------------

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models'

const TIMEOUT_MS = 15_000

/** Long enough that opening the settings tab twice costs one call, short enough
 *  that a model added today turns up today. */
const CACHE_MS = 10 * 60 * 1000

export type GoogleModel = {
  /** What goes in the settings box: `gemini-3.8-flash`, no `models/` prefix. */
  id: string
  /** What Google calls it for people: "Gemini 3.8 Flash", "Nano Banana 2". */
  label: string
}

export type GoogleModelLists = {
  /** Models that draw. */
  image: GoogleModel[]
  /** Models that write. */
  text: GoogleModel[]
}

const ListBody = z.object({
  models: z.array(z.object({
    name: z.string(),
    displayName: z.string().optional(),
    supportedGenerationMethods: z.array(z.string()).optional(),
  })).optional(),
  nextPageToken: z.string().optional(),
})

const ErrorBody = z.object({
  error: z.object({ message: z.string().optional() }).optional(),
})

/**
 * Whether an id names something that draws pictures.
 *
 * Google's listing says which METHODS a model supports and never which
 * modalities it emits, so an image model and a writing model are the same shape
 * in the response and only the name tells them apart. `-image` is Google's own
 * convention and `nano-banana` is the family's public name.
 *
 * A naming rule can rot, and this one is allowed to: the worst it can do is
 * leave a model out of a menu that still has a text box beside it.
 */
export function isImageModel(id: string): boolean {
  return /(^|-)image($|-)/.test(id) || id.includes('nano-banana')
}

/** Things that answer `generateContent` and still cannot write a reply: they
 *  draw, speak, listen, compose, drive a robot or run for half an hour. */
const NOT_FOR_WRITING = [
  /(^|-)image($|-)/, /nano-banana/, /(^|-)tts($|-)/, /transcribe/, /embedding/,
  /^lyria/, /robotics/, /computer-use/, /deep-research/, /antigravity/,
]

export function isWritingModel(id: string, methods: string[]): boolean {
  if (!methods.includes('generateContent')) return false
  return !NOT_FOR_WRITING.some((pattern) => pattern.test(id))
}

/** Sorted so the newest generation is at the top, which is what somebody
 *  choosing wants, and alphabetically within it so the order is stable. */
function byNewest(a: GoogleModel, b: GoogleModel): number {
  const version = (id: string) => {
    const found = /(\d+(?:\.\d+)?)/.exec(id)
    return found?.[1] ? Number(found[1]) : 0
  }
  const difference = version(b.id) - version(a.id)
  return difference !== 0 ? difference : a.id.localeCompare(b.id)
}

let cached: { key: string, at: number, value: GoogleModelLists } | null = null

/**
 * Every model this key may use, split into the two the settings screen asks
 * about. Throws {@link GoogleAiError} with something worth reading.
 *
 * Cached against the key itself, so pasting a different key does not answer out
 * of the last one's list.
 */
export async function listGoogleModels(apiKey: string): Promise<GoogleModelLists> {
  if (cached && cached.key === apiKey && Date.now() - cached.at < CACHE_MS) return cached.value

  let response: Response
  try {
    response = await fetch(`${ENDPOINT}?pageSize=200`, {
      headers: { 'x-goog-api-key': apiKey },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (error) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      throw new GoogleAiError('Google took too long to say which models it has.', 504)
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
    if (response.status === 401 || response.status === 403) {
      throw new GoogleAiError('Google refused that API key.', 401)
    }
    if (response.status === 429) {
      throw new GoogleAiError('Google is rate limiting this key at the moment.', 429, parseRetryAfter(response.headers.get('retry-after')))
    }
    const message = parsed.success ? parsed.data.error?.message : undefined
    throw new GoogleAiError(message ? `Google said: ${message}` : `Google returned an error (${response.status}).`)
  }

  const parsed = ListBody.safeParse(json)
  if (!parsed.success) throw new GoogleAiError('Google answered with something this module could not read.')

  const value = splitModels(parsed.data.models ?? [])
  cached = { key: apiKey, at: Date.now(), value }
  return value
}

/** The pure half, so the sorting and the filtering can be tested without a
 *  network. Exported for the tests and for nothing else. */
export function splitModels(
  models: Array<{ name: string, displayName?: string, supportedGenerationMethods?: string[] }>,
): GoogleModelLists {
  const image: GoogleModel[] = []
  const writing: GoogleModel[] = []

  for (const model of models) {
    const id = model.name.replace(/^models\//, '')
    if (!id) continue
    const methods = model.supportedGenerationMethods ?? []
    const entry: GoogleModel = { id, label: model.displayName?.trim() || id }
    if (isImageModel(id)) {
      // An image model that cannot be called at all is not one to offer.
      if (methods.includes('generateContent')) image.push(entry)
      continue
    }
    if (isWritingModel(id, methods)) writing.push(entry)
  }

  return { image: image.sort(byNewest), text: writing.sort(byNewest) }
}
