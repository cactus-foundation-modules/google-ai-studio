import { prisma } from '@/lib/db/prisma'
import { dimensionsFromBuffer } from '@/lib/media/dimensions'
import { resolveFolderPath } from '@/lib/media/organise'
import { getActiveMediaProvider, isMediaProviderConfigured } from '@/lib/config/env'
import { saveMediaRecord, uploadMedia, validateUpload } from '@/lib/media/upload'
import { getCandidate, markCandidateImported } from '@/modules/google-ai-studio/lib/jobs'

// Accepting a picture is the moment it stops being scratch: it goes into the
// media library like any other upload, in the same folder as the product's own
// photographs, and the candidate row remembers which media item it became so a
// second press of Add cannot quietly make a second copy.

export class ImportError extends Error {
  readonly status: number
  constructor(message: string, status = 400) {
    super(message)
    this.name = 'ImportError'
    this.status = status
  }
}

export type ImportedImage = { candidateId: string, mediaId: string, url: string }

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

/** A filename an owner can recognise a month later, from the product's own name. */
export function candidateFilename(productName: string | null, mimeType: string, index: number): string {
  const stem = (productName ?? 'ai-photo')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'ai-photo'
  const stamp = new Date().toISOString().slice(0, 10)
  return `${stem}-ai-${stamp}-${index + 1}.${EXTENSIONS[mimeType] ?? 'jpg'}`
}

/** The product's name, when there is a shop to ask. Only ever used for a filename. */
export async function productName(productId: string | null): Promise<string | null> {
  if (!productId) return null
  try {
    const rows = await prisma.$queryRaw<{ name: string }[]>`
      SELECT "name" FROM "shp_products" WHERE "id" = ${productId} LIMIT 1
    `
    return rows[0]?.name ?? null
  } catch {
    // No shop on this site, or no such product. A generic filename is fine.
    return null
  }
}

/**
 * Copy one candidate into the media library. Returns the media item it became,
 * or the one it already was if this candidate has been accepted before.
 */
export async function importCandidate(input: {
  candidateId: string
  folderId: string | null
  filename: string
  altText: string
  userId: string
}): Promise<ImportedImage> {
  const candidate = await getCandidate(input.candidateId)
  if (!candidate) throw new ImportError('That picture has expired. Make it again.', 404)

  if (candidate.mediaId) {
    const existing = await prisma.media.findUnique({ where: { id: candidate.mediaId }, select: { id: true, url: true } })
    if (existing) return { candidateId: candidate.id, mediaId: existing.id, url: existing.url }
    // The media item was deleted from the library after this candidate was
    // accepted. Fall through and put it back rather than refusing.
  }

  const provider = await getActiveMediaProvider()
  if (!provider || !isMediaProviderConfigured(provider)) {
    throw new ImportError('This site has nowhere to store pictures yet. Set up media storage in Settings first.', 503)
  }

  const validation = await validateUpload(candidate.mimeType, candidate.bytes.length, candidate.bytes)
  if (!validation.valid) throw new ImportError(validation.reason)

  const folderPath = input.folderId ? await resolveFolderPath(input.folderId) : undefined
  const result = await uploadMedia(validation.buffer, candidate.mimeType, provider, input.filename, folderPath || undefined)
  const record = await saveMediaRecord({
    key: result.key,
    url: result.url,
    provider,
    mimeType: result.mimeType,
    sizeBytes: result.sizeBytes,
    originalName: input.filename,
    uploadedById: input.userId,
    altText: input.altText || undefined,
    folderId: input.folderId,
    dimensions: await dimensionsFromBuffer(validation.buffer),
  })

  await markCandidateImported(candidate.id, record.id)
  return { candidateId: candidate.id, mediaId: record.id, url: record.url }
}
