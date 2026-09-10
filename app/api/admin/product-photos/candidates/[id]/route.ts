import { NextRequest, NextResponse } from 'next/server'
import { getSessionFromCookie } from '@/lib/auth/session'
import { hasPermission } from '@/lib/permissions/check'
import { errorResponse } from '@/lib/utils'
import { getCandidate } from '@/modules/google-ai-studio/lib/jobs'

/** The picture itself, for the review grid.
 *
 * Served from here rather than as a data url in the JSON: a handful of 2K
 * pictures inlined into one response is several megabytes of base64 the browser
 * has to hold twice, and this way the grid draws each one as it arrives.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionFromCookie()
  if (!user) return errorResponse('Not authenticated', 401)
  if (!await hasPermission(user, 'shop.products')) return errorResponse('Forbidden', 403)

  const { id } = await params
  const candidate = await getCandidate(id)
  if (!candidate) return errorResponse('That picture has expired.', 404)

  return new NextResponse(new Uint8Array(candidate.bytes), {
    headers: {
      'Content-Type': candidate.mimeType,
      'Content-Length': String(candidate.bytes.length),
      // Nothing here is public and nothing here is permanent.
      'Cache-Control': 'private, no-store',
    },
  })
}
