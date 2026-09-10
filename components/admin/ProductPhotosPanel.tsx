'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAdminPath } from '@/components/admin/AdminPathContext'
import { panelCss } from '@/modules/google-ai-studio/components/admin/panel-css'

// The AI photo section at the foot of the shop's Images tab.
//
// It imports nothing from '@/modules/shop/...' and never will: this module works
// on a site with no shop at all, and that path does not exist at build time on
// one. Everything it needs from the shop it gets the way anything else on the
// page would - the product id it was handed, the shop's own admin endpoints over
// HTTP, and one documented browser event for handing the finished pictures over.

const API = '/api/m/google-ai-studio/admin/product-photos'

// The shop's own seam for putting a picture into the gallery being edited. A
// plain window event with a documented name, so nothing has to be imported.
// See modules/shop/components/admin/product-editor/gallery-add-bus.ts. False
// back from the dispatch means nothing was listening - a shop too old to know
// the event - and the panel says so rather than pretending.
const GALLERY_ADD_EVENT = 'cactus-shop-product-gallery-add'

type SourceImage = { id: string, url: string, label: string }
type SourceGroup = { id: string, label: string, blurb: string, images: SourceImage[], truncated: boolean }

type Context = {
  configured: boolean
  defaults: { imageCount: number, aspectRatio: string, prompt: string, housePrompt: string }
  limits: { maxImageCount: number, maxReferences: number, aspectRatios: readonly string[] }
  groups: SourceGroup[]
}

type Candidate = { id: string, mimeType: string, sizeBytes: number, mediaId: string | null }

function handOverToGallery(images: Array<{ url: string, altText?: string }>): boolean {
  if (typeof window === 'undefined' || images.length === 0) return false
  const event = new CustomEvent(GALLERY_ADD_EVENT, { detail: { images }, cancelable: true })
  return !window.dispatchEvent(event)
}

/** The shop's own answer to "which media folder do this product's pictures live
 * in?". Best effort: a shop that has never heard of the endpoint simply means
 * the pictures land in the library root, which is where they used to. */
async function resolveProductFolder(productId: string): Promise<string | null> {
  try {
    const res = await fetch(`/api/m/shop/admin/products/${encodeURIComponent(productId)}/media-folder`, { method: 'POST' })
    if (!res.ok) return null
    const body = await res.json() as { folderId?: string | null }
    return body.folderId ?? null
  } catch {
    return null
  }
}

export function ProductPhotosPanel({ productId }: { productId: string }) {
  const adminPath = useAdminPath()
  const [context, setContext] = useState<Context | null>(null)
  const [picked, setPicked] = useState<string[]>([])
  const [prompt, setPrompt] = useState('')
  const [housePrompt, setHousePrompt] = useState('')
  const [count, setCount] = useState(3)
  const [aspectRatio, setAspectRatio] = useState('1:1')
  const [jobId, setJobId] = useState<string | null>(null)
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [keeping, setKeeping] = useState<string[]>([])
  const [pending, setPending] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`${API}/sources?productId=${encodeURIComponent(productId)}`)
        if (!res.ok) return
        const body = await res.json() as Context
        if (cancelled) return
        setContext(body)
        setCount(body.defaults.imageCount)
        setAspectRatio(body.defaults.aspectRatio)
        setHousePrompt(body.defaults.housePrompt)
      } catch { /* the panel simply does not offer itself */ }
    })()
    return () => { cancelled = true }
  }, [productId])

  const maxReferences = context?.limits.maxReferences ?? 10
  const allImages = useMemo(() => (context?.groups ?? []).flatMap((g) => g.images), [context])
  const pickedUrls = useMemo(
    () => picked.flatMap((id) => { const found = allImages.find((i) => i.id === id); return found ? [found.url] : [] }),
    [picked, allImages],
  )

  const toggle = (id: string) => {
    setError('')
    setPicked((current) => {
      if (current.includes(id)) return current.filter((x) => x !== id)
      if (current.length >= maxReferences) {
        setError(`Google will work from at most ${maxReferences} pictures at a time.`)
        return current
      }
      return [...current, id]
    })
  }

  const toggleKeep = (id: string) => {
    setKeeping((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]))
  }

  const discard = useCallback(async (id: string | null) => {
    setCandidates([])
    setKeeping([])
    setJobId(null)
    setPending(0)
    if (!id) return
    try { await fetch(`${API}/jobs/${id}`, { method: 'DELETE' }) } catch { /* the sweep will get it */ }
  }, [])

  const create = useCallback(async () => {
    if (!context) return
    setBusy(true)
    setError('')
    setNote('')
    // Anything still on screen from a previous go is thrown away first, so the
    // review grid is only ever about the request just made.
    await discard(jobId)

    try {
      const started = await fetch(`${API}/jobs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ productId, urls: pickedUrls, count, aspectRatio, housePrompt, prompt }),
      })
      const startedBody = await started.json().catch(() => null) as { jobId?: string, error?: string } | null
      if (!started.ok || !startedBody?.jobId) {
        setError(startedBody?.error ?? 'Could not start that job.')
        return
      }
      const id = startedBody.jobId
      setJobId(id)
      setPending(count)

      // One picture per request: Google answers with one at a time, and this way
      // each appears as it lands rather than after the lot of them.
      for (let made = 0; made < count; made++) {
        const res = await fetch(`${API}/jobs/${id}/images`, { method: 'POST' })
        const body = await res.json().catch(() => null) as { candidate?: Candidate, error?: string } | null
        if (!res.ok || !body?.candidate) {
          setError(body?.error ?? 'Google could not make that picture.')
          setPending(0)
          return
        }
        const candidate = body.candidate
        setCandidates((current) => [...current, candidate])
        setPending((current) => Math.max(current - 1, 0))
      }
    } catch {
      setError('Could not reach the site to make those pictures.')
      setPending(0)
    } finally {
      setBusy(false)
      setPending(0)
    }
  }, [context, discard, jobId, productId, pickedUrls, count, aspectRatio, housePrompt, prompt])

  const keep = useCallback(async () => {
    if (keeping.length === 0) return
    setBusy(true)
    setError('')
    setNote('')
    try {
      const folderId = await resolveProductFolder(productId)
      const res = await fetch(`${API}/import`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ candidateIds: keeping, folderId }),
      })
      const body = await res.json().catch(() => null) as { imported?: Array<{ candidateId: string, url: string }>, error?: string } | null
      const imported = body?.imported ?? []
      if (imported.length > 0) {
        const taken = handOverToGallery(imported.map((image) => ({ url: image.url })))
        setNote(taken
          ? `${imported.length} picture${imported.length === 1 ? '' : 's'} added to the gallery above. Save the product to keep them.`
          : `${imported.length} picture${imported.length === 1 ? '' : 's'} saved to your media library. Add them with the Add images button above.`)
        const done = new Set(imported.map((image) => image.candidateId))
        setCandidates((current) => current.filter((c) => !done.has(c.id)))
        setKeeping((current) => current.filter((id) => !done.has(id)))
      }
      if (!res.ok) setError(body?.error ?? 'Could not add those pictures.')
    } catch {
      setError('Could not reach the site to add those pictures.')
    } finally {
      setBusy(false)
    }
  }, [keeping, productId])

  if (!context) return null

  const settingsHref = `/${adminPath}/config?tab=google-ai-studio`
  const reviewing = candidates.length > 0 || pending > 0

  return (
    <section className="gas-card">
      <style>{panelCss}</style>
      <h3 className="gas-head">AI photo creation</h3>
      <p className="gas-blurb">
        Pick the photographs Google should work from, say what you would like, and choose from what
        comes back. Nothing is added to this product until you say so.
      </p>

      {!context.configured && (
        <div className="alert alert-warning">
          There is no Google AI Studio key on this site yet. <a href={settingsHref}>Add one in Settings</a> and
          this section starts working.
        </div>
      )}

      {context.groups.length === 0 ? (
        <p className="gas-note">
          This product has no photographs yet. Add one above and Google will have something to work from.
        </p>
      ) : (
        context.groups.map((group) => (
          <div className="gas-group" key={group.id}>
            <h4 className="gas-group-head">{group.label}</h4>
            <p className="gas-group-blurb">
              {group.blurb}{group.truncated ? ' Showing the first few.' : ''}
            </p>
            <div className="gas-grid">
              {group.images.map((image) => {
                const isPicked = picked.includes(image.id)
                return (
                  <button
                    type="button"
                    key={image.id}
                    className="gas-tile"
                    data-picked={isPicked ? 'true' : undefined}
                    aria-pressed={isPicked}
                    onClick={() => toggle(image.id)}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- media library urls are arbitrary remote hosts, not a configured next/image loader */}
                    <img src={image.url} alt="" />
                    <span className="gas-tick" aria-hidden>{isPicked ? '✓' : ''}</span>
                    <span className="gas-tile-label" title={image.label}>{image.label}</span>
                  </button>
                )
              })}
            </div>
          </div>
        ))
      )}

      <div className="gas-field" style={{ marginBottom: '1rem' }}>
        <label className="gas-label" htmlFor="gas-prompt">What would you like a picture of?</label>
        <textarea
          id="gas-prompt"
          rows={3}
          value={prompt}
          placeholder="The same desk in a bright open-plan office, seen from the side."
          onChange={(e) => setPrompt(e.target.value)}
        />
        <p className="gas-hint">
          Describe the shot, not the product - the pictures you ticked above are what tells Google
          what the product looks like.
        </p>
      </div>

      <details className="gas-details">
        <summary>House style (used on every job)</summary>
        <textarea
          rows={4}
          value={housePrompt}
          aria-label="House style"
          onChange={(e) => setHousePrompt(e.target.value)}
        />
        <p className="gas-hint">
          Changed here, it applies to this job only. Change it for every job on the{' '}
          <a href={settingsHref}>Google AI Studio settings tab</a>.
        </p>
      </details>

      <div className="gas-row">
        <div className="gas-field">
          <label className="gas-label" htmlFor="gas-count">How many</label>
          <input
            id="gas-count"
            type="number"
            min={1}
            max={context.limits.maxImageCount}
            value={count}
            style={{ width: '5rem' }}
            onChange={(e) => setCount(Math.min(Math.max(Number(e.target.value) || 1, 1), context.limits.maxImageCount))}
          />
        </div>
        <div className="gas-field">
          <label className="gas-label" htmlFor="gas-aspect">Shape</label>
          <select id="gas-aspect" value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value)}>
            {context.limits.aspectRatios.map((ratio) => <option key={ratio} value={ratio}>{ratio}</option>)}
          </select>
        </div>
        <div className="gas-actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !context.configured || (!prompt.trim() && !housePrompt.trim())}
            onClick={() => { void create() }}
          >
            {busy && pending > 0 ? `Making ${pending} more…` : 'Create pictures'}
          </button>
          {picked.length > 0 && (
            <span className="gas-note">{picked.length} picture{picked.length === 1 ? '' : 's'} to work from</span>
          )}
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {note && <div className="alert alert-success">{note}</div>}

      {reviewing && (
        <div className="gas-group">
          <h4 className="gas-group-head">What came back</h4>
          <p className="gas-group-blurb">
            Tick the ones worth keeping. The rest are thrown away - they are never added to your
            media library.
          </p>
          <div className="gas-grid">
            {candidates.map((candidate) => {
              const isKept = keeping.includes(candidate.id)
              return (
                <button
                  type="button"
                  key={candidate.id}
                  className="gas-tile"
                  data-picked={isKept ? 'true' : undefined}
                  aria-pressed={isKept}
                  onClick={() => toggleKeep(candidate.id)}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- a candidate is served from this module's own endpoint, not a configured next/image loader */}
                  <img src={`${API}/candidates/${candidate.id}`} alt="" />
                  <span className="gas-tick" aria-hidden>{isKept ? '✓' : ''}</span>
                </button>
              )
            })}
            {Array.from({ length: pending }, (_, i) => (
              <div className="gas-placeholder" key={`pending-${i}`}>Working…</div>
            ))}
          </div>
          <div className="gas-actions" style={{ marginTop: '0.75rem' }}>
            <button type="button" className="btn btn-primary" disabled={busy || keeping.length === 0} onClick={() => { void keep() }}>
              Add {keeping.length > 0 ? keeping.length : ''} to product images
            </button>
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => { void discard(jobId) }}>
              Discard
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
