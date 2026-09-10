import { NextRequest, NextResponse } from 'next/server'
import { getSessionFromCookie } from '@/lib/auth/session'
import { hasPermission } from '@/lib/permissions/check'
import { errorResponse } from '@/lib/utils'
import { getGoogleAiConfig } from '@/modules/google-ai-studio/lib/settings'
import { GoogleAiError, generateImage } from '@/modules/google-ai-studio/lib/gemini'
import { loadReferences } from '@/modules/google-ai-studio/lib/references'
import { addJobImage, getJob, listJobImages } from '@/modules/google-ai-studio/lib/jobs'

/** Make ONE more picture for this job.
 *
 * One call, one picture, on purpose. Google's image API answers with a single
 * picture per request, so four means four calls - and doing them from the
 * browser one at a time keeps every request well inside the sixty seconds a
 * module route gets, and lets each picture appear as it lands instead of after
 * the lot of them.
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionFromCookie()
  if (!user) return errorResponse('Not authenticated', 401)
  if (!await hasPermission(user, 'shop.products')) return errorResponse('Forbidden', 403)

  const { id } = await params
  const job = await getJob(id)
  if (!job) return errorResponse('That job has expired. Start it again.', 404)

  const already = await listJobImages(id)
  if (already.length >= job.requested) {
    return errorResponse('That job has made everything it was asked for.', 409)
  }

  const config = await getGoogleAiConfig()
  if (!config.apiKey) {
    return errorResponse('There is no Google AI Studio key on this site yet. Add one in Settings.', 400)
  }

  const urls = Array.isArray(job.source_urls) ? job.source_urls.filter((u): u is string => typeof u === 'string') : []

  try {
    const references = await loadReferences(urls)
    const image = await generateImage({
      apiKey: config.apiKey,
      // The job's own model and shape, not today's settings: a job half way
      // through must not change its mind because somebody saved the settings
      // screen in another tab.
      model: job.model,
      prompt: job.prompt,
      references,
      aspectRatio: job.aspect_ratio,
      imageSize: job.image_size,
    })
    const candidate = await addJobImage(id, image.mimeType, image.bytes)
    return NextResponse.json({ candidate, made: already.length + 1, requested: job.requested }, { status: 201 })
  } catch (error) {
    if (error instanceof GoogleAiError) return errorResponse(error.message, error.status)
    console.error('[google-ai-studio] image generation failed', error)
    return errorResponse('Something went wrong making that picture.', 500)
  }
}
