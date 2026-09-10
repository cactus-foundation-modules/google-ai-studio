import type { ReferenceImage } from '@/modules/google-ai-studio/lib/gemini'
import { GoogleAiError } from '@/modules/google-ai-studio/lib/gemini'

// Turning the pictures the owner ticked into the bytes Google wants.
//
// Only urls this site itself offered are ever fetched - the route checks each
// one against the list it handed the browser - so this is not a fetcher that
// will go wherever it is pointed.

/** Google takes a good many reference pictures; this is a sane working limit. */
export const MAX_REFERENCES = 10

const MAX_BYTES_EACH = 8 * 1024 * 1024
const MAX_BYTES_TOTAL = 20 * 1024 * 1024
const FETCH_TIMEOUT_MS = 15_000

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

function typeOf(response: Response): string {
  const header = response.headers.get('content-type') ?? ''
  return header.split(';')[0]?.trim().toLowerCase() ?? ''
}

async function fetchOne(url: string): Promise<ReferenceImage> {
  let response: Response
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  } catch {
    throw new GoogleAiError('One of the pictures could not be read from your media library.', 502)
  }
  if (!response.ok) throw new GoogleAiError('One of the pictures could not be read from your media library.', 502)

  const mimeType = typeOf(response)
  if (!ALLOWED_TYPES.has(mimeType)) {
    throw new GoogleAiError('Only JPEG, PNG and WebP pictures can be used as a reference.', 400)
  }

  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length === 0) throw new GoogleAiError('One of the pictures is empty.', 400)
  if (bytes.length > MAX_BYTES_EACH) {
    throw new GoogleAiError('One of the pictures is too large to send. Optimise it in the media library first.', 400)
  }
  return { mimeType, data: bytes.toString('base64') }
}

/**
 * Check a picture that arrived as bytes rather than as a url - a view captured
 * from a 3D model, say, which has no url and never will.
 *
 * The same two questions asked of a fetched picture, asked of this one: is it a
 * kind Google takes, and is it a sane size. Anything else is refused outright
 * rather than trimmed, because a reference the owner cannot see the effect of is
 * worse than one they were told about.
 */
export function checkInlineReference(mimeType: string, base64: string): ReferenceImage {
  if (!ALLOWED_TYPES.has(mimeType)) {
    throw new GoogleAiError('Only JPEG, PNG and WebP pictures can be used as a reference.', 400)
  }
  const bytes = Buffer.byteLength(base64, 'base64')
  if (bytes === 0) throw new GoogleAiError('One of those views came through empty.', 400)
  if (bytes > MAX_BYTES_EACH) {
    throw new GoogleAiError('One of those views is too large to send.', 400)
  }
  return { mimeType, data: base64 }
}

/**
 * Fetch every chosen picture, in parallel, and hand back what Google wants -
 * with anything already held as bytes tacked on the end, in the order it was
 * given.
 *
 * Throws {@link GoogleAiError} with something worth reading if any one of them
 * cannot be used - a job that quietly drops a reference produces a picture the
 * owner cannot account for.
 */
export async function loadReferences(urls: string[], inline: ReferenceImage[] = []): Promise<ReferenceImage[]> {
  if (urls.length === 0 && inline.length === 0) return []
  if (urls.length + inline.length > MAX_REFERENCES) {
    throw new GoogleAiError(`Choose at most ${MAX_REFERENCES} pictures to work from.`, 400)
  }

  const fetched = await Promise.all(urls.map(fetchOne))
  const images = [...fetched, ...inline]
  const total = images.reduce((sum, image) => sum + image.data.length, 0)
  if (total > MAX_BYTES_TOTAL) {
    throw new GoogleAiError('Those pictures come to too much altogether. Choose fewer, or smaller ones.', 400)
  }
  return images
}
