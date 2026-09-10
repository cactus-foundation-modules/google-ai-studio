import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSessionFromCookie } from '@/lib/auth/session'
import { hasPermission } from '@/lib/permissions/check'
import { errorResponse } from '@/lib/utils'
import {
  ASPECT_RATIOS,
  DEFAULT_PRODUCT_PHOTO_PROMPT,
  DEFAULT_REPLY_HOUSE_STYLE,
  IMAGE_SIZES,
  MAX_IMAGE_COUNT,
  getGoogleAiConfig,
  updateSettings,
} from '@/modules/google-ai-studio/lib/settings'
import { getPhotoCapabilities } from '@/modules/google-ai-studio/lib/capabilities'

async function guard() {
  const user = await getSessionFromCookie()
  if (!user) return { error: errorResponse('Not authenticated', 401) }
  if (!await hasPermission(user, 'google-ai-studio.manage')) return { error: errorResponse('Forbidden', 403) }
  return { user }
}

async function currentState() {
  const [config, caps] = await Promise.all([getGoogleAiConfig(), getPhotoCapabilities()])
  return {
    // The key itself never goes back to the browser - only whether there is one.
    hasApiKey: !!config.apiKey,
    apiKeyFromEnv: config.apiKeyFromEnv,
    imageModel: config.imageModel,
    textModel: config.textModel,
    defaultImageCount: config.defaultImageCount,
    productPhotoPrompt: config.productPhotoPrompt,
    replyHouseStyle: config.replyHouseStyle,
    aspectRatio: config.aspectRatio,
    imageSize: config.imageSize,
    housePromptDefault: DEFAULT_PRODUCT_PHOTO_PROMPT,
    replyHouseStyleDefault: DEFAULT_REPLY_HOUSE_STYLE,
    maxImageCount: MAX_IMAGE_COUNT,
    aspectRatios: ASPECT_RATIOS,
    imageSizes: IMAGE_SIZES,
    hasShop: caps.hasShop,
  }
}

export async function GET() {
  const { error } = await guard()
  if (error) return error
  return NextResponse.json(await currentState(), { headers: { 'Cache-Control': 'no-store' } })
}

const Body = z.object({
  apiKey: z.string().min(1).max(500).optional(),
  clearApiKey: z.boolean().optional(),
  imageModel: z.string().min(1).max(120).optional(),
  textModel: z.string().min(1).max(120).optional(),
  defaultImageCount: z.number().int().min(1).max(MAX_IMAGE_COUNT).optional(),
  productPhotoPrompt: z.string().max(4000).optional(),
  replyHouseStyle: z.string().max(4000).optional(),
  aspectRatio: z.enum(ASPECT_RATIOS).optional(),
  imageSize: z.enum(IMAGE_SIZES).optional(),
})

export async function PATCH(request: NextRequest) {
  const { error } = await guard()
  if (error) return error

  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errorResponse('Those settings did not make sense.')

  try {
    await updateSettings(parsed.data)
  } catch (cause) {
    // The only realistic failure is encrypting the key, and it has exactly one
    // cause worth naming.
    console.error('[google-ai-studio] could not save settings', cause)
    return errorResponse('Could not save those settings. Check that this site has an encryption key set up.', 500)
  }

  return NextResponse.json(await currentState())
}
