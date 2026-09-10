import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSessionFromCookie } from '@/lib/auth/session'
import { hasPermission } from '@/lib/permissions/check'
import { errorResponse } from '@/lib/utils'
import { getCandidate, getJob } from '@/modules/google-ai-studio/lib/jobs'
import { ImportError, candidateFilename, importCandidate, productName } from '@/modules/google-ai-studio/lib/media-import'

const Body = z.object({
  candidateIds: z.array(z.string().min(1)).min(1).max(8),
  /** The media library folder the product's own pictures live in, resolved by
   * the browser from the shop's own endpoint. Null puts them in the root. */
  folderId: z.string().min(1).nullish(),
  altText: z.string().max(300).optional(),
})

/**
 * Take the chosen pictures into the media library and hand back their urls.
 * What happens to them next is the product editor's business: this route never
 * touches the shop's own tables.
 */
export async function POST(request: NextRequest) {
  const user = await getSessionFromCookie()
  if (!user) return errorResponse('Not authenticated', 401)
  if (!await hasPermission(user, 'shop.products')) return errorResponse('Forbidden', 403)

  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errorResponse('That request did not make sense.')
  const { candidateIds, folderId = null, altText = '' } = parsed.data

  // Name the files after the product they belong to, which means finding out
  // which job they came from. Every candidate in one press comes from the same
  // job, so this is one lookup rather than one per picture.
  const first = await getCandidate(candidateIds[0] ?? '')
  if (!first) return errorResponse('Those pictures have expired. Make them again.', 404)
  const job = await getJob(first.jobId)
  const name = await productName(job?.subject_id ?? null)

  const imported = []
  try {
    // One at a time on purpose: each upload writes bytes to the media provider,
    // and a burst of parallel writes is how a provider starts refusing them.
    for (const [index, candidateId] of candidateIds.entries()) {
      imported.push(await importCandidate({
        candidateId,
        folderId,
        filename: candidateFilename(name, first.mimeType, index),
        altText,
        userId: user.id,
      }))
    }
  } catch (error) {
    if (error instanceof ImportError) {
      // Whatever did land is reported alongside the failure, so the owner is
      // not left wondering which half of the press worked.
      return NextResponse.json({ error: error.message, imported }, { status: error.status })
    }
    console.error('[google-ai-studio] could not import a generated picture', error)
    return errorResponse('Could not add those pictures to your media library.', 500)
  }

  return NextResponse.json({ imported }, { status: 201 })
}
