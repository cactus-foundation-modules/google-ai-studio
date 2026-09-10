import { ProductPhotosPanel } from '@/modules/google-ai-studio/components/admin/ProductPhotosPanel'

/**
 * This module's contribution to `shop.product-editor-media-sections`: the AI
 * photo section at the foot of a product's Images tab.
 *
 * A server component, as the point expects, and deliberately a thin one - the
 * panel loads what it needs through this module's own endpoints, which is what
 * keeps the whole feature free of any import from the shop.
 */
export function ProductPhotosSection({ productId }: { productId: string }) {
  return <ProductPhotosPanel productId={productId} />
}
