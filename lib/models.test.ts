import { describe, expect, it } from 'vitest'
import { isImageModel, isWritingModel, splitModels } from '@/modules/google-ai-studio/lib/models'
import { answerText } from '@/modules/google-ai-studio/lib/gemini-text'

// The names below are Google's real ones, read off `GET /v1beta/models` with a
// live key on 2026-09-10. That is the entire point of this file: the module's
// first writing default was `gemini-3.1-flash`, invented by pattern-matching
// the picture model's name, and Google has never had one.
const REAL = [
  { name: 'models/gemini-3.8-flash', displayName: 'Gemini 3.8 Flash', supportedGenerationMethods: ['generateContent', 'countTokens'] },
  { name: 'models/gemini-3.5-flash', displayName: 'Gemini 3.5 Flash', supportedGenerationMethods: ['generateContent', 'countTokens'] },
  { name: 'models/gemini-2.5-pro', displayName: 'Gemini 2.5 Pro', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/gemini-3.1-flash-image', displayName: 'Nano Banana 2', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/gemini-3-pro-image', displayName: 'Nano Banana Pro', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/nano-banana-pro-preview', displayName: 'Nano Banana Pro', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/gemini-2.5-flash-preview-tts', displayName: 'Gemini 2.5 Flash Preview TTS', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/gemini-3.5-transcribe', displayName: 'Gemini 3.5 Transcribe', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/lyria-3.5', displayName: 'Lyria 3.5', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/gemini-robotics-er-2-preview', displayName: 'Gemini Robotics-ER 2 Preview', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/deep-research-preview-04-2026', displayName: 'Deep Research Preview', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/text-embedding-004', displayName: 'Text Embedding 004', supportedGenerationMethods: ['embedContent'] },
  { name: 'models/gemini-2.5-flash-live-preview', displayName: 'Live', supportedGenerationMethods: ['bidiGenerateContent'] },
]

describe('isImageModel', () => {
  it('knows Google’s own naming for the ones that draw', () => {
    expect(isImageModel('gemini-3.1-flash-image')).toBe(true)
    expect(isImageModel('gemini-3-pro-image')).toBe(true)
    expect(isImageModel('nano-banana-pro-preview')).toBe(true)
  })

  it('does not mistake a writing model for one', () => {
    expect(isImageModel('gemini-3.8-flash')).toBe(false)
    expect(isImageModel('gemini-2.5-pro')).toBe(false)
  })
})

describe('isWritingModel', () => {
  it('needs generateContent - a Live model speaks bidiGenerateContent and would 404 here', () => {
    expect(isWritingModel('gemini-2.5-flash-live-preview', ['bidiGenerateContent'])).toBe(false)
    expect(isWritingModel('gemini-3.8-flash', ['generateContent'])).toBe(true)
  })

  it('leaves out the ones that answer generateContent and still cannot write a reply', () => {
    for (const id of [
      'gemini-3.1-flash-image', 'gemini-2.5-flash-preview-tts', 'gemini-3.5-transcribe',
      'lyria-3.5', 'gemini-robotics-er-2-preview', 'deep-research-preview-04-2026',
    ]) {
      expect(isWritingModel(id, ['generateContent'])).toBe(false)
    }
  })
})

describe('splitModels', () => {
  const { image, text } = splitModels(REAL)

  it('offers only models that write in the writing menu', () => {
    expect(text.map((m) => m.id)).toEqual(['gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-2.5-pro'])
  })

  it('offers only models that draw in the picture menu', () => {
    expect(image.map((m) => m.id)).toEqual(['gemini-3.1-flash-image', 'gemini-3-pro-image', 'nano-banana-pro-preview'])
  })

  it('puts the newest generation first, so the top of the menu is the one to pick', () => {
    expect(text[0]?.id).toBe('gemini-3.8-flash')
  })

  it('strips the models/ prefix, because that is not what goes in the settings box', () => {
    expect(text.every((m) => !m.id.startsWith('models/'))).toBe(true)
  })

  it('falls back to the id when Google gave no display name', () => {
    const [only] = splitModels([{ name: 'models/gemini-9-flash', supportedGenerationMethods: ['generateContent'] }]).text
    expect(only).toEqual({ id: 'gemini-9-flash', label: 'gemini-9-flash' })
  })

  it('never offers the invented name that started all this', () => {
    expect(text.map((m) => m.id)).not.toContain('gemini-3.1-flash')
  })
})

describe('answerText', () => {
  it('joins the answer parts, because structured output may arrive in several', () => {
    expect(answerText([{ text: '["one",' }, { text: '"two"]' }])).toBe('["one","two"]')
  })

  it('DROPS a reasoning part rather than joining it onto the answer', () => {
    // Verified against a real call: the flash models worth using here think
    // before they answer (a thousand tokens of it), and reasoning glued to the
    // front of the JSON would fail to parse and be served to somebody as a
    // draft reply.
    expect(answerText([
      { text: 'Let me consider the tone here...', thought: true },
      { text: '["A reply."]' },
    ])).toBe('["A reply."]')
  })

  it('has nothing to say when every part was reasoning', () => {
    expect(answerText([{ text: 'thinking', thought: true }])).toBeNull()
    expect(answerText([])).toBeNull()
    expect(answerText([{ text: '   ' }])).toBeNull()
  })
})
