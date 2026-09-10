import { prisma } from '@/lib/db/prisma'

// The ONE place that answers "what else is on this site?".
//
// This module works on a site with a shop, without one, and will grow features
// that have nothing to do with shops at all. So it declares no `requiresModules`
// and imports nothing from '@/modules/shop/...' or the modules around it - those
// paths do not exist at build time on an install without them, and a static
// import would break that build. Presence is probed by TABLE rather than by a
// Module row, because the tables are what the raw SQL below actually needs and a
// module row can exist for a whole deploy before its migration has run.

export type PhotoCapabilities = {
  /** A product catalogue with pictures on it. */
  hasShop: boolean
  /** Products with variations, each of which may carry a photograph of its own. */
  hasVariations: boolean
  /** Filterable attributes, some of which may be pictures. */
  hasAttributes: boolean
}

let cached: { value: PhotoCapabilities, at: number } | null = null
const TTL_MS = 30_000

async function presentTables(names: string[]): Promise<Set<string>> {
  const rows = await prisma.$queryRaw<{ table_name: string }[]>`
    SELECT "table_name"
      FROM information_schema.tables
     WHERE "table_schema" = 'public' AND "table_name" = ANY(${names}::text[])
  `
  return new Set(rows.map((r) => r.table_name))
}

export async function getPhotoCapabilities(): Promise<PhotoCapabilities> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value

  const present = await presentTables([
    'shp_products',
    'shp_product_media',
    'svr_variants',
    'svr_option_values',
    'svr_options',
    'svr_variant_values',
    'pat_attributes',
    'pat_attribute_values',
    'pat_product_values',
  ])

  const value: PhotoCapabilities = {
    hasShop: present.has('shp_products') && present.has('shp_product_media'),
    hasVariations: ['svr_variants', 'svr_option_values', 'svr_options', 'svr_variant_values'].every((t) => present.has(t)),
    hasAttributes: ['pat_attributes', 'pat_attribute_values', 'pat_product_values'].every((t) => present.has(t)),
  }

  cached = { value, at: Date.now() }
  return value
}
