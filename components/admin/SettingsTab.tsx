'use client'

import { useCallback, useEffect, useState } from 'react'

const API = '/api/m/google-ai-studio/admin/settings'

type State = {
  hasApiKey: boolean
  apiKeyFromEnv: boolean
  imageModel: string
  textModel: string
  defaultImageCount: number
  productPhotoPrompt: string
  replyHouseStyle: string
  aspectRatio: string
  imageSize: string
  housePromptDefault: string
  replyHouseStyleDefault: string
  maxImageCount: number
  aspectRatios: string[]
  imageSizes: string[]
  hasShop: boolean
}

type Draft = {
  apiKey: string
  imageModel: string
  textModel: string
  defaultImageCount: number
  productPhotoPrompt: string
  replyHouseStyle: string
  aspectRatio: string
  imageSize: string
}

function draftOf(state: State): Draft {
  return {
    // Never seeded from the server: the key itself is not sent back, and an
    // empty box means "leave whatever is saved alone".
    apiKey: '',
    imageModel: state.imageModel,
    textModel: state.textModel,
    defaultImageCount: state.defaultImageCount,
    productPhotoPrompt: state.productPhotoPrompt,
    replyHouseStyle: state.replyHouseStyle,
    aspectRatio: state.aspectRatio,
    imageSize: state.imageSize,
  }
}

export function GoogleAiStudioSettingsTab() {
  const [saved, setSaved] = useState<State | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await fetch(API)
      if (!res.ok) return
      const state = await res.json() as State
      setSaved(state)
      setDraft(draftOf(state))
    } catch { /* retry on next open */ }
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      await Promise.resolve()
      if (!cancelled) await load()
    })()
    return () => { cancelled = true }
  }, [load])

  const send = useCallback(async (body: Record<string, unknown>) => {
    setBusy(true)
    setMsg('')
    setErr('')
    try {
      const res = await fetch(API, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const answer = await res.json().catch(() => null) as (State & { error?: string }) | null
      if (!res.ok) {
        setErr(answer?.error ?? 'Could not save those settings.')
        return
      }
      if (answer) {
        setSaved(answer)
        setDraft(draftOf(answer))
      }
      setMsg('Saved.')
    } catch {
      setErr('Could not reach the site to save those settings.')
    } finally {
      setBusy(false)
    }
  }, [])

  if (!saved || !draft) return <p className="field-hint">Loading…</p>

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft({ ...draft, [key]: value })

  const save = () => {
    const body: Record<string, unknown> = {
      imageModel: draft.imageModel,
      textModel: draft.textModel,
      defaultImageCount: draft.defaultImageCount,
      productPhotoPrompt: draft.productPhotoPrompt,
      replyHouseStyle: draft.replyHouseStyle,
      aspectRatio: draft.aspectRatio,
      imageSize: draft.imageSize,
    }
    if (draft.apiKey.trim()) body.apiKey = draft.apiKey.trim()
    void send(body)
  }

  return (
    <div>
      <p className="field-hint" style={{ marginBottom: '1.25rem' }}>
        One key from Google AI Studio, and this site can make pictures for you and draft replies to
        your customers. With the Shop installed, a product&rsquo;s Images tab grows an AI photo
        section; with a mailbox or a contact form installed, the reply box grows a
        &ldquo;Suggest reply&rdquo; button. Google charges for both, so the settings below are worth
        a moment&rsquo;s thought.
      </p>

      {saved.apiKeyFromEnv && (
        <div className="alert alert-info">
          The key is set on this site&rsquo;s hosting rather than here, so there is nothing to type
          in. Change it where it is set and it takes effect on the next deploy.
        </div>
      )}

      {!saved.apiKeyFromEnv && (
        <div className="field">
          <label>Google AI Studio API key</label>
          <input
            type="password"
            autoComplete="off"
            value={draft.apiKey}
            placeholder={saved.hasApiKey ? 'A key is saved. Type a new one to replace it.' : 'Paste your key here'}
            onChange={(e) => set('apiKey', e.target.value)}
          />
          <p className="field-hint">
            From <strong>aistudio.google.com</strong>, under Get API key. It is stored encrypted and
            never shown again - if you lose it, make another one there and paste it in.
            {saved.hasApiKey && (
              <>
                {' '}
                <button
                  type="button"
                  className="btn btn-link btn-sm"
                  disabled={busy}
                  onClick={() => { void send({ clearApiKey: true }) }}
                >
                  Remove the saved key
                </button>
              </>
            )}
          </p>
        </div>
      )}

      {!saved.hasShop && (
        <div className="alert alert-info">
          There is no shop on this site yet, so there is nothing for the picture-making to attach
          itself to. The key keeps until there is.
        </div>
      )}

      <h3 style={{ fontSize: '0.9375rem', margin: '1.5rem 0 0.25rem' }}>Pictures</h3>

      <div className="field">
        <label>How many pictures a job makes</label>
        <input
          type="number"
          min={1}
          max={saved.maxImageCount}
          value={draft.defaultImageCount}
          style={{ maxWidth: '8rem' }}
          onChange={(e) => set('defaultImageCount', Math.min(Math.max(Number(e.target.value) || 1, 1), saved.maxImageCount))}
        />
        <p className="field-hint">
          The number each job starts on. It can be changed for any one job, and every picture is
          charged for separately, so three is a sensible place to start.
        </p>
      </div>

      <div className="field">
        <label>House style</label>
        <textarea
          rows={5}
          value={draft.productPhotoPrompt}
          onChange={(e) => set('productPhotoPrompt', e.target.value)}
        />
        <p className="field-hint">
          Added to the front of every product photo job - the way your photographs always look,
          rather than what any one of them is of. It can be adjusted for a single job without
          changing it here.
          {draft.productPhotoPrompt !== saved.housePromptDefault && (
            <>
              {' '}
              <button
                type="button"
                className="btn btn-link btn-sm"
                onClick={() => set('productPhotoPrompt', saved.housePromptDefault)}
              >
                Restore the standard wording
              </button>
            </>
          )}
        </p>
      </div>

      <div className="field">
        <label>Shape</label>
        <select value={draft.aspectRatio} style={{ maxWidth: '10rem' }} onChange={(e) => set('aspectRatio', e.target.value)}>
          {saved.aspectRatios.map((ratio) => <option key={ratio} value={ratio}>{ratio}</option>)}
        </select>
        <p className="field-hint">What shape new pictures come out. Square suits most product listings.</p>
      </div>

      <div className="field">
        <label>Size</label>
        <select value={draft.imageSize} style={{ maxWidth: '10rem' }} onChange={(e) => set('imageSize', e.target.value)}>
          {saved.imageSizes.map((size) => <option key={size} value={size}>{size}</option>)}
        </select>
        <p className="field-hint">
          Bigger costs more and takes longer. 2K is plenty for a product page.
        </p>
      </div>

      <div className="field">
        <label>Model</label>
        <input
          type="text"
          value={draft.imageModel}
          onChange={(e) => set('imageModel', e.target.value)}
        />
        <p className="field-hint">
          Which of Google&rsquo;s picture models to use. Leave it alone unless Google has named a new
          one and you would like to try it.
        </p>
      </div>

      <h3 style={{ fontSize: '0.9375rem', margin: '1.5rem 0 0.25rem' }}>Replies</h3>
      <p className="field-hint" style={{ marginBottom: '0.75rem' }}>
        Wherever this site has a reply box - a mailbox, the contact form - there is a
        &ldquo;Suggest reply&rdquo; button under it. Pressing it sends that conversation to Google
        and offers three drafts back. Nothing is ever sent to anybody without somebody reading it
        first, and nothing at all leaves this site until the button is pressed.
      </p>

      <div className="field">
        <label>House style for replies</label>
        <textarea
          rows={5}
          value={draft.replyHouseStyle}
          onChange={(e) => set('replyHouseStyle', e.target.value)}
        />
        <p className="field-hint">
          How your business sounds when it writes to somebody - formal or friendly, brisk or
          chatty, what you would never say. Not what to say: that is the conversation&rsquo;s
          business, and a house style that starts answering questions will happily invent the
          answers.
          {draft.replyHouseStyle !== saved.replyHouseStyleDefault && (
            <>
              {' '}
              <button
                type="button"
                className="btn btn-link btn-sm"
                onClick={() => set('replyHouseStyle', saved.replyHouseStyleDefault)}
              >
                Restore the standard wording
              </button>
            </>
          )}
        </p>
      </div>

      <div className="field">
        <label>Writing model</label>
        <input
          type="text"
          value={draft.textModel}
          onChange={(e) => set('textModel', e.target.value)}
        />
        <p className="field-hint">
          Which of Google&rsquo;s models writes the drafts. A different one from the picture model
          above, because a model that draws cannot write a sentence. Leave it alone unless Google
          has named a new one and you would like to try it.
        </p>
      </div>

      {err && <div className="alert alert-error">{err}</div>}
      {msg && <div className="alert alert-success">{msg}</div>}

      <button type="button" className="btn btn-primary" onClick={save} disabled={busy}>
        {busy ? 'Saving…' : 'Save'}
      </button>
    </div>
  )
}
