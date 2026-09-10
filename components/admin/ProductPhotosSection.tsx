import { getSessionFromCookie } from '@/lib/auth/session'
import { hasPermission } from '@/lib/permissions/check'
import { prisma } from '@/lib/db/prisma'
import { INSTALLED_MODULE_WHERE } from '@/lib/modules/live-status'
import { ProductPhotosPanel } from '@/modules/google-ai-studio/components/admin/ProductPhotosPanel'

/**
 * This module's contribution to `shop.product-editor-media-sections`: the AI
 * photo section at the foot of a product's Images tab.
 *
 * A server component, as the point expects, and deliberately a thin one - the
 * panel loads what it needs through this module's own endpoints, which is what
 * keeps the whole feature free of any import from the shop.
 *
 * The one thing it does do here is resolve this module's OWN extension point,
 * `google-ai-studio.reference-image-sources`, and hand the panel the pieces it
 * finds. That is a server-side job twice over: the map of components can only be
 * imported on a server, and which modules are installed is a database question.
 */

/** A picker some other module offers for producing extra reference pictures.
 * Today: the 3D views module, which captures stills off a product's own model. */
type SourceEntry = {
  point: string
  id: string
  /** What the button opening it should say. */
  label?: string
  order?: number
  permission?: string
}

const POINT = 'google-ai-studio.reference-image-sources'

async function resolveSources(user: Awaited<ReturnType<typeof getSessionFromCookie>>): Promise<SourceEntry[]> {
  if (!user) return []
  const modules = await prisma.module.findMany({ where: { ...INSTALLED_MODULE_WHERE }, select: { manifest: true } })
  const entries: SourceEntry[] = []
  for (const mod of modules) {
    const manifest = mod.manifest as { extensionPoints?: SourceEntry[] } | null
    for (const entry of manifest?.extensionPoints ?? []) {
      if (entry.point !== POINT) continue
      if (!entry.permission || (await hasPermission(user, entry.permission))) entries.push(entry)
    }
  }
  return entries.sort((a, b) => (a.order ?? 999) - (b.order ?? 999))
}

export async function ProductPhotosSection({ productId }: { productId: string }) {
  const user = await getSessionFromCookie()
  const entries = await resolveSources(user)
  // Imported here rather than at the top of the file, and deliberately: this
  // module contributes a component to the shop's own point, so the generated
  // registry already imports THIS file. A static import back the other way is a
  // cycle between the registry and module code, which lib/modules/import-cycles
  // fails the build over. Reached inside the function, it is not.
  const { moduleExtensionPointComponents } = await import('@/lib/modules/extension-points')
  const components = moduleExtensionPointComponents[POINT] ?? {}

  // Rendered here and passed down as nodes, the way the shop hands this very
  // panel to its own client editor. The panel decides WHEN to mount one - a
  // WebGL context and a model download are not a fair price for a section the
  // owner has not opened yet.
  const sources = entries.flatMap((entry) => {
    const Picker = components[entry.id]
    if (!Picker) return []
    return [{
      id: entry.id,
      label: entry.label ?? 'More pictures',
      node: <Picker key={entry.id} productId={productId} />,
    }]
  })

  return <ProductPhotosPanel productId={productId} sources={sources} />
}
