// The panel's own styling, injected by the panel itself.
//
// It renders inside the shop's product editor, which has a stylesheet of its
// own - but that stylesheet belongs to the shop, and this module does not
// depend on the shop. So it brings its own, written entirely in core's semantic
// tokens so it follows the site's theme in light and dark without knowing
// anything about either.
export const panelCss = `
.gas-card{background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius-lg);padding:1.25rem}
.gas-head{margin:0 0 0.25rem;font-size:0.9375rem;font-weight:600}
.gas-blurb{margin:0 0 1rem;font-size:0.8125rem;color:var(--color-text-secondary);max-width:60ch}
.gas-group{margin-bottom:1rem}
.gas-group-head{margin:0 0 0.125rem;font-size:0.8125rem;font-weight:600}
.gas-group-blurb{margin:0 0 0.5rem;font-size:0.75rem;color:var(--color-text-secondary)}
.gas-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(7rem,100%),1fr));gap:0.5rem}
.gas-tile{position:relative;display:block;border:1px solid var(--color-border);border-radius:var(--radius-md);overflow:hidden;background:var(--color-bg-subtle);cursor:pointer;padding:0;text-align:left;width:100%}
.gas-tile[data-picked="true"]{outline:2px solid var(--color-primary);outline-offset:1px;border-color:var(--color-primary)}
.gas-tile[data-busy="true"]{opacity:0.55}
.gas-tile img{width:100%;aspect-ratio:1;object-fit:cover;display:block}
.gas-tile-label{display:block;padding:0.25rem 0.375rem;font-size:0.6875rem;color:var(--color-text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;border-top:1px solid var(--color-border);background:var(--color-surface)}
.gas-tick{position:absolute;top:0.375rem;left:0.375rem;width:1.125rem;height:1.125rem;border-radius:var(--radius-full);border:1px solid var(--color-border);background:var(--color-surface);display:flex;align-items:center;justify-content:center;font-size:0.6875rem;line-height:1;color:var(--color-on-primary)}
.gas-tile[data-picked="true"] .gas-tick{background:var(--color-primary);border-color:var(--color-primary)}
.gas-row{display:flex;flex-wrap:wrap;gap:1rem;align-items:flex-end;margin-bottom:1rem}
.gas-field{display:flex;flex-direction:column;gap:0.25rem;min-width:0}
.gas-label{font-size:0.8125rem;font-weight:500}
.gas-hint{margin:0.25rem 0 0;font-size:0.75rem;color:var(--color-text-secondary);max-width:60ch}
.gas-actions{display:flex;flex-wrap:wrap;gap:0.5rem;align-items:center}
.gas-note{font-size:0.75rem;color:var(--color-text-secondary)}
.gas-details{margin:0 0 1rem;font-size:0.8125rem}
.gas-details summary{cursor:pointer;color:var(--color-text-secondary)}
.gas-details textarea{margin-top:0.5rem}
.gas-placeholder{display:flex;align-items:center;justify-content:center;aspect-ratio:1;font-size:0.75rem;color:var(--color-text-secondary);background:var(--color-bg-subtle);border:1px dashed var(--color-border);border-radius:var(--radius-md)}
`
