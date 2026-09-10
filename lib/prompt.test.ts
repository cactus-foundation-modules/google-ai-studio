import { describe, expect, it } from 'vitest'
import { composePrompt } from '@/modules/google-ai-studio/lib/prompt'

describe('composePrompt', () => {
  it('puts the job prompt last, where it carries most weight', () => {
    expect(composePrompt('House style.', 'On a beach.')).toBe('House style.\n\nOn a beach.')
  })

  it('drops an empty half rather than leaving blank lines behind', () => {
    expect(composePrompt('', 'On a beach.')).toBe('On a beach.')
    expect(composePrompt('House style.', '   ')).toBe('House style.')
    expect(composePrompt('  ', '')).toBe('')
  })
})
