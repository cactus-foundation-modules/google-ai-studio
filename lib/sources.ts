import { prisma } from '@/lib/db/prisma'
import { getPhotoCapabilities } from '@/modules/google-ai-studio/lib/capabilities'

// Every picture already on this site that could sensibly be handed to Google as
// a reference for a new product photograph, gathered by raw SQL from tables this
// module does not own. Reading another module's tables is fine (it is what the
// capability probe exists for); writing to them is not, and nothing here does.

/** Most pictures offered per group. A fabric range can run to hundreds, and a
 * picker nobody can scroll is no better than no picker at all. */
const GROUP_LIMIT = 60

export type SourceImage = {
  /** Stable within this response, and what the browser sends back. */
  id: string
  url: string
  label: string
}

export type SourceGroup = {
  id: 'product' | 'variations' | 'attributes'
  label: string
  /** One line saying where these came from, shown under the group's heading. */
  blurb: string
  images: SourceImage[]
  /** True when the group had more pictures than it is showing. */
  truncated: boolean
}

type MediaRow = { url: string, alt_text: string | null }
type VariantRow = { url: string, alt_text: string | null, label: string | null }
type AttributeRow = { attribute: string, label: string, swatch: string }

function take<T>(rows: T[]): { rows: T[], truncated: boolean } {
  return { rows: rows.slice(0, GROUP_LIMIT), truncated: rows.length > GROUP_LIMIT }
}

async function productImages(productId: string): Promise<SourceGroup | null> {
  const rows = await prisma.$queryRaw<MediaRow[]>`
    SELECT "url", "alt_text"
      FROM "shp_product_media"
     WHERE "product_id" = ${productId} AND "type" = 'IMAGE'
     ORDER BY "position" ASC
  `
  if (rows.length === 0) return null
  const { rows: shown, truncated } = take(rows)
  return {
    id: 'product',
    label: 'This product',
    blurb: 'The photographs already on the Images tab above.',
    images: shown.map((row, i) => ({
      id: `product:${i}`,
      url: row.url,
      label: row.alt_text || `Image ${i + 1}`,
    })),
    truncated,
  }
}

async function variationImages(productId: string): Promise<SourceGroup | null> {
  // One photograph per variation - its first, which is the one the storefront
  // leads with. A variation is a hidden child product, so its pictures live in
  // the same table as the parent's.
  const rows = await prisma.$queryRaw<VariantRow[]>`
    SELECT m."url",
           m."alt_text",
           (SELECT string_agg(ov."label", ' / ' ORDER BY o."position" ASC, ov."position" ASC)
              FROM "svr_variant_values" vv
              JOIN "svr_option_values" ov ON ov."id" = vv."option_value_id"
              JOIN "svr_options" o ON o."id" = ov."option_id"
             WHERE vv."variant_id" = v."id") AS "label"
      FROM "svr_variants" v
      JOIN LATERAL (
             SELECT "url", "alt_text"
               FROM "shp_product_media"
              WHERE "product_id" = v."child_product_id" AND "type" = 'IMAGE'
              ORDER BY "position" ASC
              LIMIT 1
           ) m ON TRUE
     WHERE v."product_id" = ${productId} AND v."enabled" = TRUE
     ORDER BY v."position" ASC
  `
  if (rows.length === 0) return null
  const { rows: shown, truncated } = take(rows)
  return {
    id: 'variations',
    label: 'Variations',
    blurb: "The lead photograph from each of this product's variations.",
    images: shown.map((row, i) => ({
      id: `variation:${i}`,
      url: row.url,
      label: row.label || row.alt_text || `Variation ${i + 1}`,
    })),
    truncated,
  }
}

async function attributeImages(productId: string, withVariants: boolean): Promise<SourceGroup | null> {
  // Attributes whose values ARE pictures - a fabric or a finish - as set on this
  // product or on any of its variations. The child lookup only exists when the
  // variations module is installed, hence the two shapes of the same query.
  const rows = withVariants
    ? await prisma.$queryRaw<AttributeRow[]>`
        SELECT DISTINCT a."name" AS "attribute", av."label", av."swatch"
          FROM "pat_attribute_values" av
          JOIN "pat_attributes" a ON a."id" = av."attribute_id"
          JOIN "pat_product_values" pv ON pv."value_id" = av."id"
         WHERE a."control_type" = 'IMAGE'
           AND av."swatch" IS NOT NULL AND av."swatch" <> ''
           AND (pv."product_id" = ${productId}
                OR pv."product_id" IN (SELECT "child_product_id" FROM "svr_variants" WHERE "product_id" = ${productId}))
         ORDER BY a."name" ASC, av."label" ASC
      `
    : await prisma.$queryRaw<AttributeRow[]>`
        SELECT DISTINCT a."name" AS "attribute", av."label", av."swatch"
          FROM "pat_attribute_values" av
          JOIN "pat_attributes" a ON a."id" = av."attribute_id"
          JOIN "pat_product_values" pv ON pv."value_id" = av."id"
         WHERE a."control_type" = 'IMAGE'
           AND av."swatch" IS NOT NULL AND av."swatch" <> ''
           AND pv."product_id" = ${productId}
         ORDER BY a."name" ASC, av."label" ASC
      `
  if (rows.length === 0) return null
  const { rows: shown, truncated } = take(rows)
  return {
    id: 'attributes',
    label: 'Attribute pictures',
    blurb: 'Picture attributes set on this product or its variations - fabrics, finishes and the like.',
    images: shown.map((row, i) => ({
      id: `attribute:${i}`,
      url: row.swatch,
      label: `${row.attribute}: ${row.label}`,
    })),
    truncated,
  }
}

/**
 * Every picture worth offering as a reference for this product, grouped by where
 * it came from. A group that would be empty is left out rather than shown empty,
 * and a group whose module is not installed is never asked for at all.
 */
export async function listProductImageSources(productId: string): Promise<SourceGroup[]> {
  const caps = await getPhotoCapabilities()
  if (!caps.hasShop) return []

  const [product, variations, attributes] = await Promise.all([
    productImages(productId),
    caps.hasVariations ? variationImages(productId) : Promise.resolve(null),
    caps.hasAttributes ? attributeImages(productId, caps.hasVariations) : Promise.resolve(null),
  ])

  return [product, variations, attributes].filter((g): g is SourceGroup => g !== null)
}

/** Every url this response offered, for checking what the browser sends back. */
export function allowedUrls(groups: SourceGroup[]): Set<string> {
  return new Set(groups.flatMap((g) => g.images.map((i) => i.url)))
}
