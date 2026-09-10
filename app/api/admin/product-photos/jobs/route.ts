import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSessionFromCookie } from '@/lib/auth/session'
import { hasPermission } from '@/lib/permissions/check'
import { errorResponse } from '@/lib/utils'
import { ASPECT_RATIOS, MAX_IMAGE_COUNT, getGoogleAiConfig } from '@/modules/google-ai-studio/lib/settings'
import { allowedUrls, listProductImageSources } from '@/modules/google-ai-studio/lib/sources'
import { MAX_REFERENCES, checkInlineReference } from '@/modules/google-ai-studio/lib/references'
import { composePrompt } from '@/modules/google-ai-studio/lib/prompt'
import { GoogleAiError } from '@/modules/google-ai-studio/lib/gemini'
import { addJobSourceImages, createJob, sweepOldJobs } from '@/modules/google-ai-studio/lib/jobs'

/** Base64 is a third larger than the bytes it carries; references.ts refuses
 * anything over 8 MB decoded, and this stops a hopeless one being parsed first. */
const MAX_CAPTURE_BASE64 = 12 * 1024 * 1024

const Body = z.object({
  productId: z.string().min(1),
  /** Media urls to work from. Checked against what this product actually offers. */
  urls: z.array(z.string().url()).max(MAX_REFERENCES),
  count: z.number().int().min(1).max(MAX_IMAGE_COUNT),
  aspectRatio: z.enum(ASPECT_RATIOS),
  /** The house style, as edited for this job only. Omitted = the site's own. */
  housePrompt: z.string().max(4000).optional(),
  /** What is wanted this time. */
  prompt: z.string().max(4000),
  /**
   * Reference pictures that arrived as bytes rather than as urls - views
   * captured from a 3D model. Base64, no data: prefix; the browser strips it.
   * They are stored with the job, because every picture the job makes needs
   * them again and there is no url to fetch them back from.
   */
  captures: z.array(z.object({
    mimeType: z.string().max(100),
    data: z.string().min(1).max(MAX_CAPTURE_BASE64),
    label: z.string().max(200).default(''),
  })).max(MAX_REFERENCES).default([]),
})

/**
 * Start a job. This writes down what was asked for and hands back an id; the
 * pictures themselves are made one at a time by POSTing to the job's own
 * images endpoint, so no single request has to sit there for a minute.
 */
export async function POST(request: NextRequest) {
  const user = await getSessionFromCookie()
  if (!user) return errorResponse('Not authenticated', 401)
  if (!await hasPermission(user, 'shop.products')) return errorResponse('Forbidden', 403)

  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errorResponse('That request did not make sense.')
  const { productId, urls, count, aspectRatio, captures } = parsed.data

  if (urls.length + captures.length > MAX_REFERENCES) {
    return errorResponse(`Choose at most ${MAX_REFERENCES} pictures to work from.`)
  }

  const config = await getGoogleAiConfig()
  if (!config.apiKey) {
    return errorResponse('There is no Google AI Studio key on this site yet. Add one in Settings.', 400)
  }

  // Every url must be one this product actually offered. Without this the
  // endpoint would fetch whatever it was pointed at, on the site's own network.
  const groups = await listProductImageSources(productId)
  const allowed = allowedUrls(groups)
  if (urls.some((url) => !allowed.has(url))) {
    return errorResponse("One of those pictures does not belong to this product.")
  }

  const prompt = composePrompt(parsed.data.housePrompt ?? config.productPhotoPrompt, parsed.data.prompt)
  if (!prompt) return errorResponse('Say what you would like a picture of.')

  // Old jobs go on the way past rather than on a schedule of their own: a site
  // that has stopped making pictures has nothing left to sweep.
  await sweepOldJobs()

  // Checked before the job row exists, so a bad view leaves nothing behind.
  let sources
  try {
    sources = captures.map((capture) => ({
      ...checkInlineReference(capture.mimeType, capture.data),
      label: capture.label,
    }))
  } catch (error) {
    if (error instanceof GoogleAiError) return errorResponse(error.message, error.status)
    throw error
  }

  const jobId = await createJob({
    subject: 'shop-product',
    subjectId: productId,
    prompt,
    sourceUrls: urls,
    model: config.imageModel,
    aspectRatio,
    imageSize: config.imageSize,
    requested: count,
    createdById: user.id,
  })

  await addJobSourceImages(jobId, sources)

  return NextResponse.json({ jobId, requested: count }, { status: 201 })
}
