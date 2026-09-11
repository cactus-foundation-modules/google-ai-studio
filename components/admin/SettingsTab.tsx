'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'

const API = '/api/m/google-ai-studio/admin/settings'
const MODELS_API = '/api/m/google-ai-studio/admin/models'

/** One of Google's models, as the menus below offer it. The shape is declared
 *  here rather than imported from lib/models.ts: it is two strings, and a
 *  client component has no business reaching into a file that talks to Google. */
type GoogleModel = { id: string, label: string }

type ModelLists = { image: GoogleModel[], text: GoogleModel[], note?: string }

/**
 * A model setting: Google's own list where we could get it, a text box where we
 * could not, and a way between the two whichever way round you start.
 *
 * Both of these were text boxes to begin with, so that a model Google named
 * this morning needs no module release to use. That much was right; what it
 * missed is that a typed name is a guess, and a wrong guess is not found out
 * until somebody presses the button an hour later and gets a 404 with Google's
 * name on it. So the list is offered and the box is kept.
 */
function ModelField({ label, hint, value, options, note, disabled, onChange }: {
  label: string
  hint: ReactNode
  value: string
  options: GoogleModel[]
  /** Why there is no list, when there is no list. */
  note: string
  disabled: boolean
  onChange: (value: string) => void
}) {
  const known = options.some((model) => model.id === value)
  // 'auto' follows the saved value: a name off the list gets the list, and a
  // name that is not on it gets the box, so somebody looking at a setting that
  // does not work sees the thing they typed rather than a menu quietly showing
  // something else.
  const [mode, setMode] = useState<'auto' | 'list' | 'text'>('auto')
  const showList = options.length > 0 && (mode === 'list' || (mode === 'auto' && known))

  return (
    <div className="field">
      <label>{label}</label>
      {showList ? (
        <select
          value={known ? value : ''}
          disabled={disabled}
          style={{ maxWidth: '22rem' }}
          onChange={(e) => onChange(e.target.value)}
        >
          {!known && <option value="" disabled>Choose a model</option>}
          {options.map((model) => (
            <option key={model.id} value={model.id}>
              {model.label === model.id ? model.id : `${model.label} - ${model.id}`}
            </option>
          ))}
        </select>
      ) : (
        <input type="text" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
      )}

      {options.length > 0 && !known && (
        <p className="field-hint" style={{ color: 'var(--color-danger)' }}>
          Google&rsquo;s list has no <strong>{value || 'model'}</strong> on this key. That is why
          nothing comes back when you use it. Pick one from the list instead.
        </p>
      )}

      <p className="field-hint">
        {hint}
        {' '}
        {options.length > 0 ? (
          <button
            type="button"
            className="btn btn-link btn-sm"
            onClick={() => setMode(showList ? 'text' : 'list')}
          >
            {showList ? 'Type a name instead' : 'Choose from Google\u2019s list'}
          </button>
        ) : note}
      </p>
    </div>
  )
}

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
  // Asked of Google, once the settings are in, so a model name is chosen rather
  // than typed from memory. A soft failure everywhere: no key, no network, a
  // rate limit - the two fields fall back to the boxes they have always been.
  const [models, setModels] = useState<ModelLists>({ image: [], text: [] })
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

  const loadModels = useCallback(async () => {
    try {
      const res = await fetch(MODELS_API)
      if (!res.ok) return
      setModels(await res.json() as ModelLists)
    } catch { /* the text boxes still work */ }
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      await Promise.resolve()
      if (cancelled) return
      await load()
      if (!cancelled) await loadModels()
    })()
    return () => { cancelled = true }
  }, [load, loadModels])

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
      // A key pasted in - or taken out - changes what Google will tell us, and
      // the list is cached against the key it was fetched with.
      void loadModels()
    } catch {
      setErr('Could not reach the site to save those settings.')
    } finally {
      setBusy(false)
    }
  }, [loadModels])

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

      <ModelField
        label="Model"
        value={draft.imageModel}
        options={models.image}
        note={models.note ?? ''}
        disabled={busy}
        onChange={(value) => set('imageModel', value)}
        hint={<>Which of Google&rsquo;s picture models to use. Leave it alone unless Google has named a new one and you would like to try it.</>}
      />

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

      <ModelField
        label="Writing model"
        value={draft.textModel}
        options={models.text}
        note={models.note ?? ''}
        disabled={busy}
        onChange={(value) => set('textModel', value)}
        hint={<>Which of Google&rsquo;s models writes the drafts. A different one from the picture model above, because a model that draws cannot write a sentence.</>}
      />

      {err && <div className="alert alert-error">{err}</div>}
      {msg && <div className="alert alert-success">{msg}</div>}

      <button type="button" className="btn btn-primary" onClick={save} disabled={busy}>
        {busy ? 'Saving…' : 'Save'}
      </button>
    </div>
  )
}
