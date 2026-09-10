import { NextRequest, NextResponse } from 'next/server'
import { getSessionFromCookie } from '@/lib/auth/session'
import { hasPermission } from '@/lib/permissions/check'
import { errorResponse } from '@/lib/utils'
import { deleteJob, getJob } from '@/modules/google-ai-studio/lib/jobs'

/** Throw the job away, pictures and all. What the Discard button does, and what
 * the sweep would do a day later anyway. */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionFromCookie()
  if (!user) return errorResponse('Not authenticated', 401)
  if (!await hasPermission(user, 'shop.products')) return errorResponse('Forbidden', 403)

  const { id } = await params
  const job = await getJob(id)
  // Already gone is a fine outcome for a delete - say so rather than 404ing at
  // somebody who pressed Discard twice.
  if (job) await deleteJob(id)
  return NextResponse.json({ ok: true })
}
