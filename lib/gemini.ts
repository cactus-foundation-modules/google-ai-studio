import { z } from 'zod'

// ---------------------------------------------------------------------------
// Google AI Studio's Interactions API, the part of it that makes pictures.
//
// One call, one picture. The API takes reference images and a prompt and hands
// back a single image; asking for four means four calls, which is also why the
// UI generates them one at a time and shows each as it lands rather than making
// the owner watch a spinner for a minute.
// ---------------------------------------------------------------------------

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/interactions'

// Every module API route shares one 60-second ceiling on the dispatcher, so the
// call has to give up before the platform does - a clean "Google took too long"
// beats a truncated response the browser cannot explain.
const TIMEOUT_MS = 50_000

/** A picture handed to Google to work from. */
export type ReferenceImage = { mimeType: string, data: string }

export type GenerateImageInput = {
  apiKey: string
  model: string
  prompt: string
  references: ReferenceImage[]
  aspectRatio: string
  imageSize: string
}

export type GeneratedImage = { mimeType: string, bytes: Buffer }

/** Thrown for anything the owner needs told about in words. */
export class GoogleAiError extends Error {
  readonly status: number
  /** How long Google asked us to wait, where it said. Only ever set on a 429. */
  readonly retryAfterSeconds: number | null
  constructor(message: string, status = 502, retryAfterSeconds: number | null = null) {
    super(message)
    this.name = 'GoogleAiError'
    this.status = status
    this.retryAfterSeconds = retryAfterSeconds
  }
}

/**
 * Google's `Retry-After`, in seconds, when it sent one worth honouring.
 *
 * The header comes in two shapes and both are legal: a plain number of seconds,
 * or an HTTP date. Anything else - absent, unparseable, in the past, or a value
 * so large it is plainly not about this request - answers null and lets the
 * caller's own backoff decide. Capped at an hour so a stray header cannot park
 * a browser on a countdown until Christmas.
 */
export function parseRetryAfter(header: string | null, now: number = Date.now()): number | null {
  if (!header) return null
  const trimmed = header.trim()
  if (/^\d+$/.test(trimmed)) {
    const seconds = Number(trimmed)
    return seconds > 0 && seconds <= 3600 ? seconds : null
  }
  const at = Date.parse(trimmed)
  if (Number.isNaN(at)) return null
  const seconds = Math.ceil((at - now) / 1000)
  return seconds > 0 && seconds <= 3600 ? seconds : null
}

// The two shapes a picture comes back in: the convenience property, and the
// step-by-step content the model actually emitted. Both are optional here on
// purpose - the parse must not fail just because Google added a field.
const ImagePart = z.object({
  type: z.literal('image'),
  mime_type: z.string().optional(),
  data: z.string(),
})

const ResponseBody = z.object({
  status: z.string().optional(),
  output_image: z.object({ mime_type: z.string().optional(), data: z.string() }).nullish(),
  steps: z.array(z.object({
    type: z.string().optional(),
    content: z.array(z.union([ImagePart, z.object({ type: z.string() }).passthrough()])).optional(),
  })).optional(),
})

const ErrorBody = z.object({
  error: z.object({ message: z.string().optional(), status: z.string().optional() }).optional(),
})

/** Plain English for the handful of failures an owner can actually do something about. */
function describeHttpFailure(httpStatus: number, message: string | undefined, retryAfter: number | null): GoogleAiError {
  if (httpStatus === 400 && message) return new GoogleAiError(`Google would not accept that request: ${message}`, 400)
  if (httpStatus === 401 || httpStatus === 403) {
    return new GoogleAiError('Google refused that API key. Check it on the Google AI Studio settings tab.', 401)
  }
  if (httpStatus === 404) {
    return new GoogleAiError('Google does not know that model. Check the model name on the Google AI Studio settings tab.', 404)
  }
  if (httpStatus === 429) {
    // The one failure that mends itself. The message is kept for anywhere that
    // shows it plainly; the caller that can wait keys off the 429 and the hint.
    return new GoogleAiError('Google is rate limiting this key at the moment.', 429, retryAfter)
  }
  return new GoogleAiError(message ? `Google said: ${message}` : `Google returned an error (${httpStatus}).`)
}

function firstImage(body: z.infer<typeof ResponseBody>): { mimeType: string, data: string } | null {
  if (body.output_image?.data) {
    return { mimeType: body.output_image.mime_type ?? 'image/jpeg', data: body.output_image.data }
  }
  for (const step of body.steps ?? []) {
    for (const part of step.content ?? []) {
      if (part.type === 'image' && 'data' in part && typeof part.data === 'string' && part.data) {
        const mime = 'mime_type' in part && typeof part.mime_type === 'string' ? part.mime_type : 'image/jpeg'
        return { mimeType: mime, data: part.data }
      }
    }
  }
  return null
}

/** Make one picture. Throws {@link GoogleAiError} with something worth reading. */
export async function generateImage(input: GenerateImageInput): Promise<GeneratedImage> {
  const body = {
    model: input.model,
    input: [
      { type: 'text', text: input.prompt },
      ...input.references.map((ref) => ({ type: 'image', mime_type: ref.mimeType, data: ref.data })),
    ],
    response_format: {
      type: 'image',
      mime_type: 'image/jpeg',
      aspect_ratio: input.aspectRatio,
      image_size: input.imageSize,
    },
    stream: false,
    // Nothing is kept on Google's side. These are somebody's product
    // photographs, and this module has no business leaving copies about.
    store: false,
  }

  let response: Response
  try {
    response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': input.apiKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (error) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      throw new GoogleAiError('Google took too long to answer. Try again, or ask for fewer pictures at once.', 504)
    }
    throw new GoogleAiError('Could not reach Google AI Studio.')
  }

  const text = await response.text()
  const json: unknown = text ? JSON.parse(text) as unknown : null

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

  const image = firstImage(parsed.data)
  if (!image) {
    // A refusal comes back as a perfectly good response with no picture in it,
    // which is the one failure an owner is most likely to be able to fix.
    throw new GoogleAiError('Google produced no picture for that request. Try describing the shot differently.', 422)
  }

  const bytes = Buffer.from(image.data, 'base64')
  if (bytes.length === 0) throw new GoogleAiError('Google returned an empty picture.')
  return { mimeType: image.mimeType, bytes }
}
