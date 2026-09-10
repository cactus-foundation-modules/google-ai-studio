import { ReplySuggestionError } from '@/lib/conversations/reply-suggestion-error'
import type { ReplySuggester, ReplySuggestionRequest } from '@/lib/conversations/types'
import { GoogleAiError } from '@/modules/google-ai-studio/lib/gemini'
import { generateDrafts } from '@/modules/google-ai-studio/lib/gemini-text'
import { composeReplyPrompt } from '@/modules/google-ai-studio/lib/reply-prompt'
import { getGoogleAiConfig } from '@/modules/google-ai-studio/lib/settings'

// What this module publishes at `core.reply-suggestions`.
//
// It knows nothing whatever about where the conversation came from - a contact
// form, a mailbox, a chat somebody had with the site - and it must stay that
// way: core hands over a list of messages and a house style, and gets words
// back. See lib/conversations/types.ts for the contract at the other end.
//
// SERVER ONLY, and the manifest entry says so: this reads a decrypted API key.

export const googleAiReplySuggester: ReplySuggester = {
  label: 'Google AI Studio',

  /** A key and a model named. Cheap by contract - one row, no round trip to
   *  Google - because a reply box asks this while it is being drawn. */
  async isConfigured(): Promise<boolean> {
    const config = await getGoogleAiConfig()
    return !!config.apiKey && !!config.textModel
  },

  async suggest(request: ReplySuggestionRequest): Promise<string[]> {
    const config = await getGoogleAiConfig()
    if (!config.apiKey) {
      throw new ReplySuggestionError(
        'There is no Google AI Studio key on this site yet, so there is nothing to write with.',
        409,
      )
    }

    const prompt = composeReplyPrompt({
      houseStyle: config.replyHouseStyle,
      subject: request.subject,
      authorName: request.authorName,
      messages: request.messages,
      count: request.count,
    })

    try {
      return await generateDrafts({
        apiKey: config.apiKey,
        model: config.textModel,
        prompt,
        count: request.count,
      })
    } catch (cause) {
      // Google's own wording is the useful part - "check the key", "we do not
      // know that model" - so it is carried across rather than flattened into
      // "something went wrong". Its status comes with it, so a rate limit still
      // reads as one at the other end.
      if (cause instanceof GoogleAiError) throw new ReplySuggestionError(cause.message, cause.status)
      throw cause
    }
  },
}
