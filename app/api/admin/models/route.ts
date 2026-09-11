import { NextResponse } from 'next/server'
import { getSessionFromCookie } from '@/lib/auth/session'
import { hasPermission } from '@/lib/permissions/check'
import { errorResponse } from '@/lib/utils'
import { GoogleAiError } from '@/modules/google-ai-studio/lib/gemini'
import { listGoogleModels } from '@/modules/google-ai-studio/lib/models'
import { getGoogleAiConfig } from '@/modules/google-ai-studio/lib/settings'

// What this site's key may actually use, for the two menus on the settings tab.
//
// A soft failure everywhere: no key yet, Google unreachable, a rate limit - the
// settings screen falls back to the text boxes it has always had rather than
// refusing to open. Hence 200 with an empty pair and a sentence, rather than an
// error status the screen would have to treat as broken.

export async function GET() {
  const user = await getSessionFromCookie()
  if (!user) return errorResponse('Not authenticated', 401)
  if (!await hasPermission(user, 'google-ai-studio.manage')) return errorResponse('Forbidden', 403)

  const config = await getGoogleAiConfig()
  if (!config.apiKey) {
    return NextResponse.json(
      { image: [], text: [], note: 'Paste a key in and save it, and this list fills itself in from Google.' },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  }

  try {
    const models = await listGoogleModels(config.apiKey)
    return NextResponse.json(models, { headers: { 'Cache-Control': 'no-store' } })
  } catch (cause) {
    const note = cause instanceof GoogleAiError
      ? cause.message
      : 'Could not ask Google which models it has just now.'
    if (!(cause instanceof GoogleAiError)) console.error('[google-ai-studio] could not list models', cause)
    return NextResponse.json({ image: [], text: [], note }, { headers: { 'Cache-Control': 'no-store' } })
  }
}
