import { prisma } from '@/lib/db/prisma'
import { encryptSecret, tryDecryptSecret } from '@/lib/crypto/secrets'

// ---------------------------------------------------------------------------
// Module settings, resolved env-first.
//
// The key can come from a Vercel env var (a pre-provisioned install never has
// to open the settings screen at all) or from the singleton row, where it is
// stored encrypted. Env wins, so rotating the env var can never be shadowed by
// a stale row - the same rule the live-chat module settled on.
// ---------------------------------------------------------------------------

/** The house style every product photo job starts from, unless the owner rewrites it. */
export const DEFAULT_PRODUCT_PHOTO_PROMPT = [
  'You are producing catalogue photography for an online shop.',
  'Use the supplied photographs as the truthful record of the product: keep its shape,',
  'proportions, materials, colours and every visible detail exactly as they are, and invent',
  'no feature that is not already there.',
  'Light it cleanly and evenly on a plain, uncluttered background, in sharp focus,',
  'with no text, no watermarks, no logos and no people unless asked for.',
].join(' ')

/** Google's own vocabulary for the shape of the picture. */
export const ASPECT_RATIOS = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'] as const
export type AspectRatio = (typeof ASPECT_RATIOS)[number]

/** Google's own vocabulary for how big the picture comes back. */
export const IMAGE_SIZES = ['512', '1K', '2K', '4K'] as const
export type ImageSize = (typeof IMAGE_SIZES)[number]

/** The model that made the pictures on the day this module was written. */
export const DEFAULT_IMAGE_MODEL = 'gemini-3.1-flash-image'

/** The model that wrote the words on the same day. A different job needs a
 *  different model - the picture one cannot write a sentence - so it is its own
 *  setting rather than a second use of the one above.
 *
 *  CHECKED AGAINST GOOGLE'S OWN LISTING, not guessed. The first value here was
 *  `gemini-3.1-flash`, which has never existed: that generation ships flash as
 *  `-image` and `-lite` and nothing else, so every suggestion came back "Google
 *  does not know that model". Hence lib/models.ts and the menu on the settings
 *  tab - a model name is not a thing to work out from the pattern of the last
 *  one.
 *
 *  Not the newest one, deliberately. `gemini-3.8-flash` exists and takes the
 *  request, and answered 503 UNAVAILABLE ("experiencing high demand") on every
 *  attempt the day this was written; a default is the name every install starts
 *  on, so it wants to be the one that answers rather than the one with the
 *  highest number. Both are on the menu. */
export const DEFAULT_TEXT_MODEL = 'gemini-3.5-flash'

/** How this business sounds, unless the owner says otherwise.
 *
 *  Deliberately about MANNER and not about content: what a reply says is the
 *  conversation's business, and a house style that started dictating answers
 *  would put words in somebody's mouth. Cactus knows nothing about anybody's
 *  refund policy and should not pretend to. */
export const DEFAULT_REPLY_HOUSE_STYLE = [
  'Write the way a small British business writes to a customer it wants to keep:',
  'warm, plain and to the point, British spelling throughout.',
  'No corporate padding, no exclamation marks, no promises the conversation does not already support.',
  'Answer what was actually asked, say honestly where something is not known,',
  'and keep it to a few short paragraphs.',
].join(' ')

/** Most pictures a single job may ask for. Each one is a separate charge. */
export const MAX_IMAGE_COUNT = 8

export type GoogleAiConfig = {
  apiKey: string | null
  /** True when the key came from an env var, so the settings screen says so rather than offering to change it. */
  apiKeyFromEnv: boolean
  imageModel: string
  textModel: string
  defaultImageCount: number
  productPhotoPrompt: string
  replyHouseStyle: string
  aspectRatio: AspectRatio
  imageSize: ImageSize
}

type SettingsRow = Record<string, unknown>

async function getRow(): Promise<SettingsRow | null> {
  const rows = await prisma.$queryRaw<SettingsRow[]>`
    SELECT * FROM "gas_settings" WHERE "id" = 'singleton' LIMIT 1
  `
  return rows[0] ?? null
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null
}

function asAspectRatio(value: unknown): AspectRatio {
  const found = ASPECT_RATIOS.find((r) => r === value)
  return found ?? '1:1'
}

function asImageSize(value: unknown): ImageSize {
  const found = IMAGE_SIZES.find((s) => s === value)
  return found ?? '2K'
}

export function envApiKey(): string | null {
  return str(process.env.GOOGLE_AI_STUDIO_API_KEY)
}

export async function getGoogleAiConfig(): Promise<GoogleAiConfig> {
  const row = await getRow()
  const fromEnv = envApiKey()
  const count = typeof row?.default_image_count === 'number' ? row.default_image_count : 3

  return {
    // tryDecryptSecret rather than decryptSecret: a restored backup routinely
    // carries ciphertext written under another install's key, and "this install
    // cannot read that" is a missing key, not an error worth showing anyone.
    apiKey: fromEnv ?? tryDecryptSecret(str(row?.api_key_encrypted)),
    apiKeyFromEnv: !!fromEnv,
    imageModel: str(row?.image_model) ?? DEFAULT_IMAGE_MODEL,
    textModel: str(row?.text_model) ?? DEFAULT_TEXT_MODEL,
    defaultImageCount: Math.min(Math.max(count, 1), MAX_IMAGE_COUNT),
    // Falls back to the house style rather than to nothing: the migration's own
    // default is an empty string, so a row written before anybody opened the
    // settings screen still produces a sensible prompt.
    productPhotoPrompt: str(row?.product_photo_prompt) ?? DEFAULT_PRODUCT_PHOTO_PROMPT,
    // Same fallback rule as the photo prompt above, and for the same reason:
    // the column's own default is an empty string, so an install that has never
    // opened the settings screen still sounds like somebody rather than like a
    // model with no instructions at all.
    replyHouseStyle: str(row?.reply_house_style) ?? DEFAULT_REPLY_HOUSE_STYLE,
    aspectRatio: asAspectRatio(row?.aspect_ratio),
    imageSize: asImageSize(row?.image_size),
  }
}

export type SettingsPatch = {
  apiKey?: string
  clearApiKey?: boolean
  imageModel?: string
  textModel?: string
  defaultImageCount?: number
  productPhotoPrompt?: string
  replyHouseStyle?: string
  aspectRatio?: AspectRatio
  imageSize?: ImageSize
}

export async function updateSettings(patch: SettingsPatch): Promise<void> {
  // Written one column at a time rather than as one big UPDATE: every value is
  // optional, and a template literal cannot build a SET list without losing the
  // parameterisation that keeps this safe.
  await prisma.$executeRaw`
    INSERT INTO "gas_settings" ("id") VALUES ('singleton') ON CONFLICT ("id") DO NOTHING
  `

  if (patch.clearApiKey) {
    await prisma.$executeRaw`UPDATE "gas_settings" SET "api_key_encrypted" = NULL WHERE "id" = 'singleton'`
  } else if (patch.apiKey) {
    const encrypted = encryptSecret(patch.apiKey.trim())
    await prisma.$executeRaw`UPDATE "gas_settings" SET "api_key_encrypted" = ${encrypted} WHERE "id" = 'singleton'`
  }

  if (patch.imageModel !== undefined) {
    await prisma.$executeRaw`UPDATE "gas_settings" SET "image_model" = ${patch.imageModel.trim() || DEFAULT_IMAGE_MODEL} WHERE "id" = 'singleton'`
  }
  if (patch.textModel !== undefined) {
    await prisma.$executeRaw`UPDATE "gas_settings" SET "text_model" = ${patch.textModel.trim() || DEFAULT_TEXT_MODEL} WHERE "id" = 'singleton'`
  }
  if (patch.defaultImageCount !== undefined) {
    const count = Math.min(Math.max(Math.round(patch.defaultImageCount), 1), MAX_IMAGE_COUNT)
    await prisma.$executeRaw`UPDATE "gas_settings" SET "default_image_count" = ${count} WHERE "id" = 'singleton'`
  }
  if (patch.productPhotoPrompt !== undefined) {
    await prisma.$executeRaw`UPDATE "gas_settings" SET "product_photo_prompt" = ${patch.productPhotoPrompt} WHERE "id" = 'singleton'`
  }
  if (patch.replyHouseStyle !== undefined) {
    await prisma.$executeRaw`UPDATE "gas_settings" SET "reply_house_style" = ${patch.replyHouseStyle} WHERE "id" = 'singleton'`
  }
  if (patch.aspectRatio !== undefined) {
    await prisma.$executeRaw`UPDATE "gas_settings" SET "aspect_ratio" = ${patch.aspectRatio} WHERE "id" = 'singleton'`
  }
  if (patch.imageSize !== undefined) {
    await prisma.$executeRaw`UPDATE "gas_settings" SET "image_size" = ${patch.imageSize} WHERE "id" = 'singleton'`
  }

  await prisma.$executeRaw`UPDATE "gas_settings" SET "updated_at" = CURRENT_TIMESTAMP WHERE "id" = 'singleton'`
}
