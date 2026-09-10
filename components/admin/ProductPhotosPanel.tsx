'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useAdminPath } from '@/components/admin/AdminPathContext'
import { panelCss } from '@/modules/google-ai-studio/components/admin/panel-css'
import { retryDelaySeconds } from '@/modules/google-ai-studio/lib/backoff'

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

// The other half of `google-ai-studio.reference-image-sources`. A module that can
// produce a reference picture - the 3D views module, capturing a still off a
// product's own model - dispatches this on the window with a data url, and this
// panel takes it by cancelling the event. Cancelling is how the producer learns
// anything took it: a picker sitting in a panel too old to know the event should
// say so rather than appear to work.
//
// A data url, not an upload: a view nobody chose to keep is not a file the site
// owner should have to tidy out of their media library afterwards.
const REFERENCE_EVENT = 'cactus-ai-reference-image'

/** A picker contributed to the reference-image point, rendered on the server and
 * handed down here as a node - see ProductPhotosSection. */
export type ReferenceSource = { id: string, label: string, node: ReactNode }

/**
 * What one attempt at a picture came to. Three outcomes rather than a value and
 * an exception, because "the owner pressed Stop" is not an error and should not
 * have to be told apart from one by reading a message.
 */
type ImageResult =
  | { ok: true, candidate: Candidate }
  | { ok: false, reason: 'aborted' }
  | { ok: false, reason: 'failed', message: string }

/** One picture a source produced, held in the browser until a job is started. */
type Capture = { id: string, dataUrl: string, label: string }

/**
 * Wait, in one-second slices, and answer false the moment the wait is called off.
 *
 * Sliced rather than one long timer purely so the countdown on screen is honest:
 * a single `setTimeout(45_000)` cannot say how much of itself is left, and a
 * button that sits there saying nothing for three quarters of a minute looks
 * exactly like one that has hung.
 */
async function countDown(seconds: number, signal: AbortSignal, tick: (left: number) => void): Promise<boolean> {
  for (let left = seconds; left > 0; left--) {
    if (signal.aborted) return false
    tick(left)
    const finished = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(true) }, 1000)
      function onAbort() { clearTimeout(timer); resolve(false) }
      signal.addEventListener('abort', onAbort, { once: true })
    })
    if (!finished) return false
  }
  return !signal.aborted
}

/** Split a data url into what the job endpoint wants: a media type and base64. */
function splitDataUrl(dataUrl: string): { mimeType: string, data: string } | null {
  const match = /^data:([a-z]+\/[a-z0-9.+-]+);base64,(.+)$/i.exec(dataUrl)
  if (!match?.[1] || !match[2]) return null
  return { mimeType: match[1].toLowerCase(), data: match[2] }
}

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

export function ProductPhotosPanel({ productId, sources = [] }: { productId: string, sources?: ReferenceSource[] }) {
  const adminPath = useAdminPath()
  const [context, setContext] = useState<Context | null>(null)
  const [picked, setPicked] = useState<string[]>([])
  // Pictures a contributed source made, newest last. They live here rather than
  // in the media library until a job is actually started with them.
  const [captures, setCaptures] = useState<Capture[]>([])
  // Which source's picker is open, if any. Nothing is mounted until it is: a
  // WebGL context and a model download are not a fair price for an Images tab.
  const [openSource, setOpenSource] = useState<string | null>(null)
  // Which source groups are unfolded. Held in state rather than left to the
  // browser: React writes `open` on every render, so a group the owner opened
  // would slam shut the moment anything else changed - ticking a picture, say.
  const [unfolded, setUnfolded] = useState<Record<string, boolean>>({})
  const [prompt, setPrompt] = useState('')
  const [housePrompt, setHousePrompt] = useState('')
  const [count, setCount] = useState(3)
  const [aspectRatio, setAspectRatio] = useState('1:1')
  const [jobId, setJobId] = useState<string | null>(null)
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [keeping, setKeeping] = useState<string[]>([])
  const [pending, setPending] = useState(0)
  const [busy, setBusy] = useState(false)
  // Set while a rate limit is being waited out: how many seconds are left, and
  // which attempt is coming. Null the rest of the time.
  const [waiting, setWaiting] = useState<{ left: number, attempt: number } | null>(null)
  // Ends the run in progress - a wait, or the fetch either side of it. Aborted
  // when the owner says stop, when the panel is thrown away, and when the page
  // goes: an indefinite retry has to be tied to something that ends.
  const runRef = useRef<AbortController | null>(null)
  // Whether the run in progress was called off by the Stop button, as opposed to
  // by Discard or by the panel going away. Only the first of those is owed an
  // explanation: pressing Discard already said what the owner wanted, and a
  // panel that has gone has nobody left to tell.
  const stoppedByOwnerRef = useRef(false)
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
  // The captured views that are actually ticked, in the order they were made.
  // Kept apart from the urls because they travel as bytes: there is no url to
  // fetch a still of a 3D model back from.
  const pickedCaptures = useMemo(
    () => captures.filter((capture) => picked.includes(capture.id)),
    [captures, picked],
  )

  // A source has made a picture. Taken by cancelling the event, ticked straight
  // away - it was created deliberately, one press at a time, so asking the owner
  // to tick it again would be ceremony - and left unticked only when that would
  // put the job over Google's limit.
  useEffect(() => {
    const onReference = (event: Event) => {
      const detail = (event as CustomEvent<{ dataUrl?: unknown, label?: unknown }>).detail
      const dataUrl = typeof detail?.dataUrl === 'string' ? detail.dataUrl : ''
      if (!dataUrl || !splitDataUrl(dataUrl)) return
      event.preventDefault()
      const label = typeof detail?.label === 'string' && detail.label ? detail.label : 'Captured view'
      const id = `capture:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`
      setCaptures((current) => [...current, { id, dataUrl, label }])
      setPicked((current) => (current.length >= maxReferences ? current : [...current, id]))
      setError('')
    }
    window.addEventListener(REFERENCE_EVENT, onReference)
    return () => window.removeEventListener(REFERENCE_EVENT, onReference)
  }, [maxReferences])

  const dropCapture = (id: string) => {
    setCaptures((current) => current.filter((capture) => capture.id !== id))
    setPicked((current) => current.filter((x) => x !== id))
  }

  /** How many of one group's pictures are ticked, for its folded summary. */
  const pickedIn = useCallback((groupId: string) => {
    const group = (context?.groups ?? []).find((g) => g.id === groupId)
    return (group?.images ?? []).filter((image) => picked.includes(image.id)).length
  }, [context, picked])

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
    // Whatever is still coming is being thrown away too, waiting included.
    runRef.current?.abort()
    setWaiting(null)
    setCandidates([])
    setKeeping([])
    setJobId(null)
    setPending(0)
    if (!id) return
    try { await fetch(`${API}/jobs/${id}`, { method: 'DELETE' }) } catch { /* the sweep will get it */ }
  }, [])

  // Nothing may outlive the panel. An unmount is a client-side navigation to
  // another page; pagehide covers closing the tab and a hard navigation, where
  // there is nothing to clean up but no harm in being tidy about it.
  useEffect(() => {
    const stop = () => runRef.current?.abort()
    window.addEventListener('pagehide', stop)
    return () => {
      window.removeEventListener('pagehide', stop)
      stop()
    }
  }, [])

  /** Stop waiting and give up on the rest of the job. */
  const stopWaiting = useCallback(() => {
    stoppedByOwnerRef.current = true
    runRef.current?.abort()
  }, [])

  /**
   * Make one picture, waiting out a rate limit for as long as it takes.
   *
   * A 429 is not a failure, it is a queue: the key is fine, the request is fine,
   * and the only thing wrong is the moment. So this waits and asks again, and
   * keeps doing it - the owner asked for pictures, not for a message telling them
   * to come back and press the button themselves. Every other failure is real
   * and returns at once.
   *
   * There are exactly three ways out: a picture, a real failure, or the run being
   * called off (the Stop button, leaving the page, closing the tab).
   */
  const makeOneImage = useCallback(async (id: string, signal: AbortSignal): Promise<ImageResult> => {
    for (let attempt = 1; ; attempt++) {
      let res: Response
      try {
        res = await fetch(`${API}/jobs/${id}/images`, { method: 'POST', signal })
      } catch {
        // Aborting a fetch throws, and that is not a failure worth a message -
        // the owner did it. Anything else genuinely is one, and reads as such
        // rather than as whatever the browser calls a dropped connection.
        if (signal.aborted) return { ok: false, reason: 'aborted' }
        return { ok: false, reason: 'failed', message: 'Could not reach the site to make those pictures.' }
      }

      const body = await res.json().catch(() => null) as
        { candidate?: Candidate, error?: string, retryable?: boolean, retryAfterSeconds?: number | null } | null

      if (res.ok && body?.candidate) {
        setWaiting(null)
        return { ok: true, candidate: body.candidate }
      }

      if (res.status !== 429 || !body?.retryable) {
        return { ok: false, reason: 'failed', message: body?.error ?? 'Google could not make that picture.' }
      }

      const seconds = retryDelaySeconds(attempt, body.retryAfterSeconds ?? null)
      const waited = await countDown(seconds, signal, (left) => setWaiting({ left, attempt }))
      if (!waited) return { ok: false, reason: 'aborted' }
      // Cleared before the next attempt, so the button reads "Making…" while the
      // request is actually in flight rather than still counting down.
      setWaiting(null)
    }
  }, [])

  const create = useCallback(async () => {
    if (!context) return
    setBusy(true)
    setError('')
    setNote('')
    setWaiting(null)
    // Cleared before anything can call a previous run off, so a Stop pressed
    // ages ago cannot put its message on this one.
    stoppedByOwnerRef.current = false
    // Anything still on screen from a previous go is thrown away first, so the
    // review grid is only ever about the request just made. That also ends any
    // run still going.
    await discard(jobId)

    // One controller for the whole run, so Stop, an unmount or leaving the page
    // ends whichever part of it is in flight.
    runRef.current?.abort()
    const run = new AbortController()
    runRef.current = run
    const { signal } = run

    try {
      const started = await fetch(`${API}/jobs`, {
        method: 'POST',
        signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          productId,
          urls: pickedUrls,
          captures: pickedCaptures.flatMap((capture) => {
            const parts = splitDataUrl(capture.dataUrl)
            return parts ? [{ ...parts, label: capture.label }] : []
          }),
          count,
          aspectRatio,
          housePrompt,
          prompt,
        }),
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
        const result = await makeOneImage(id, signal)
        if (!result.ok) {
          // Whatever has already landed stays on screen to be kept or thrown
          // away - it was paid for either way, stopped or failed.
          if (result.reason === 'aborted') {
            if (stoppedByOwnerRef.current) {
              setError(made > 0
                ? `Stopped. ${made} picture${made === 1 ? '' : 's'} had already been made.`
                : 'Stopped before Google made anything.')
            }
          } else {
            setError(result.message)
          }
          setPending(0)
          return
        }
        setCandidates((current) => [...current, result.candidate])
        setPending((current) => Math.max(current - 1, 0))
      }
    } catch {
      if (signal.aborted) return
      setError('Could not reach the site to make those pictures.')
      setPending(0)
    } finally {
      if (runRef.current === run) runRef.current = null
      setWaiting(null)
      setBusy(false)
      setPending(0)
    }
  }, [context, discard, jobId, makeOneImage, productId, pickedUrls, pickedCaptures, count, aspectRatio, housePrompt, prompt])

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
          This product has no photographs yet. Add one above{sources.length > 0 ? ', or make a view from its 3D model below,' : ''} and
          Google will have something to work from.
        </p>
      ) : (
        context.groups.map((group) => (
          // Collapsed by default unless it is the product's own photographs.
          // A range with forty variations is forty tiles the owner has to scroll
          // past every single time to reach the prompt box, and the ones they
          // actually tick are nearly always the product's own.
          <details
            className="gas-group gas-fold"
            key={group.id}
            // The product's own photographs start open; everything else starts
            // folded, until the owner says otherwise for this visit.
            open={unfolded[group.id] ?? group.id === 'product'}
            onToggle={(e) => {
              const open = e.currentTarget.open
              setUnfolded((current) => ({ ...current, [group.id]: open }))
            }}
          >
            <summary className="gas-fold-head">
              <span className="gas-fold-title">{group.label}</span>
              <span className="gas-fold-count">
                {group.images.length} picture{group.images.length === 1 ? '' : 's'}
                {/* Said out here because a folded group must still admit what is
                    ticked inside it - otherwise the count above the button is
                    the only clue and there is no telling where it came from. */}
                {pickedIn(group.id) > 0 ? ` · ${pickedIn(group.id)} ticked` : ''}
              </span>
            </summary>
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
          </details>
        ))
      )}

      {sources.length > 0 && (
        <div className="gas-group">
          <div className="gas-actions">
            {sources.map((source) => (
              <button
                type="button"
                key={source.id}
                className="btn btn-secondary"
                aria-expanded={openSource === source.id}
                onClick={() => setOpenSource((current) => (current === source.id ? null : source.id))}
              >
                {openSource === source.id ? `Hide ${source.label.toLowerCase()}` : source.label}
              </button>
            ))}
          </div>
          {/* Mounted only while open. The node itself was rendered on the server;
              React does not build anything behind it until it is on screen. */}
          {sources.map((source) => (
            openSource === source.id
              ? <div className="gas-source" key={`open-${source.id}`}>{source.node}</div>
              : null
          ))}
        </div>
      )}

      {captures.length > 0 && (
        <div className="gas-group">
          <h4 className="gas-group-head">Views you have made</h4>
          <p className="gas-group-blurb">
            Ticked ones go to Google with the photographs above. They are not saved anywhere -
            close this page and they are gone.
          </p>
          <div className="gas-grid">
            {captures.map((capture) => {
              const isPicked = picked.includes(capture.id)
              return (
                <div className="gas-tile-wrap" key={capture.id}>
                  <button
                    type="button"
                    className="gas-remove"
                    aria-label={`Remove ${capture.label}`}
                    onClick={() => dropCapture(capture.id)}
                  >
                    ×
                  </button>
                  <button
                    type="button"
                    className="gas-tile"
                    data-picked={isPicked ? 'true' : undefined}
                    aria-pressed={isPicked}
                    onClick={() => toggle(capture.id)}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- a data url held in this tab, not a configured next/image loader */}
                    <img src={capture.dataUrl} alt="" />
                    <span className="gas-tick" aria-hidden>{isPicked ? '✓' : ''}</span>
                    <span className="gas-tile-label" title={capture.label}>{capture.label}</span>
                  </button>
                </div>
              )
            })}
          </div>
        </div>
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
            {waiting
              ? `Waiting ${waiting.left}s…`
              : busy && pending > 0 ? `Making ${pending} more…` : 'Create pictures'}
          </button>
          {waiting && (
            <button type="button" className="btn btn-secondary" onClick={stopWaiting}>
              Stop
            </button>
          )}
          {!waiting && picked.length > 0 && (
            <span className="gas-note">
              {picked.length} picture{picked.length === 1 ? '' : 's'} to work from
              {pickedCaptures.length > 0 ? ` (${pickedCaptures.length} from your 3D model)` : ''}
            </span>
          )}
        </div>
      </div>

      {waiting && (
        <div className="alert alert-info" role="status">
          Google is rate limiting this key at the moment, which sorts itself out on its own.
          Trying again in {waiting.left} second{waiting.left === 1 ? '' : 's'}
          {waiting.attempt > 1 ? `, having tried ${waiting.attempt} times so far` : ''} - leave this
          page open and it will carry on by itself. Press <strong>Stop</strong> if you would rather
          not wait.
        </div>
      )}
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
