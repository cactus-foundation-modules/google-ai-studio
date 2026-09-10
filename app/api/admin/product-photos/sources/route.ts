import { NextRequest, NextResponse } from 'next/server'
import { getSessionFromCookie } from '@/lib/auth/session'
import { hasPermission } from '@/lib/permissions/check'
import { errorResponse } from '@/lib/utils'
import { getGoogleAiConfig, ASPECT_RATIOS, MAX_IMAGE_COUNT } from '@/modules/google-ai-studio/lib/settings'
import { listProductImageSources } from '@/modules/google-ai-studio/lib/sources'
import { MAX_REFERENCES } from '@/modules/google-ai-studio/lib/references'

/**
 * Everything the AI photo panel needs to draw itself: which pictures this
 * product can be built from, and what the site's own defaults are. One call
 * rather than three, because all of it is wanted at the same moment.
 */
export async function GET(request: NextRequest) {
  const user = await getSessionFromCookie()
  if (!user) return errorResponse('Not authenticated', 401)
  // The shop's own permission: this panel lives on the shop's product editor,
  // and anyone who may edit a product's pictures may make one here.
  if (!await hasPermission(user, 'shop.products')) return errorResponse('Forbidden', 403)

  const productId = request.nextUrl.searchParams.get('productId')
  if (!productId) return errorResponse('No product was named.')

  const [config, groups] = await Promise.all([
    getGoogleAiConfig(),
    listProductImageSources(productId),
  ])

  return NextResponse.json({
    configured: !!config.apiKey,
    defaults: {
      imageCount: config.defaultImageCount,
      aspectRatio: config.aspectRatio,
      prompt: '',
      housePrompt: config.productPhotoPrompt,
    },
    limits: {
      maxImageCount: MAX_IMAGE_COUNT,
      maxReferences: MAX_REFERENCES,
      aspectRatios: ASPECT_RATIOS,
    },
    groups,
  }, { headers: { 'Cache-Control': 'no-store' } })
}
