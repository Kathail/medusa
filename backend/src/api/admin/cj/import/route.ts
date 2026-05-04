import { MedusaRequest, MedusaResponse } from '@medusajs/framework'
import { ContainerRegistrationKeys, MedusaError, Modules } from '@medusajs/framework/utils'
import { createProductsWorkflow } from '@medusajs/medusa/core-flows'
import { CJ_DROPSHIPPING_MODULE } from '../../../../modules/cj-dropshipping'
import type CjDropshippingService from '../../../../modules/cj-dropshipping/service'

type ImportRequest = {
  pid: string
  markup: number
  // Optional overrides — admin UI can edit before submitting.
  title?: string
  handle?: string
  currency_code?: string
}

/**
 * Pricing rule (per project decision):
 *   retail = ceil(cost * markup) - 0.01
 * Always rounds the cents component up to .99.
 */
function priceCents(cost: number, markup: number): number {
  const retail = Math.ceil(cost * markup) - 0.01
  return Math.round(retail * 100)
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

export async function POST(req: MedusaRequest<ImportRequest>, res: MedusaResponse): Promise<void> {
  const { pid, markup, title, handle, currency_code = 'cad' } = req.body
  if (!pid || typeof markup !== 'number' || markup <= 0) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, 'pid and markup (>0) are required')
  }

  const cj = req.scope.resolve<CjDropshippingService>(CJ_DROPSHIPPING_MODULE)
  const link = req.scope.resolve(ContainerRegistrationKeys.LINK)

  const cjProduct = await cj.getProduct(pid)
  if (!cjProduct.variants?.length) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, `CJ product ${pid} has no variants`)
  }

  const productTitle = title ?? cjProduct.productNameEn
  const productHandle = handle ?? slugify(productTitle)

  const variantInputs = cjProduct.variants.map((v) => {
    const cost = parseFloat(v.variantSellPrice)
    if (!Number.isFinite(cost) || cost <= 0) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `CJ variant ${v.vid} has invalid variantSellPrice=${v.variantSellPrice}`
      )
    }
    return {
      cj_vid: v.vid,
      cj_sku: v.variantSku,
      cj_name: v.variantNameEn ?? cjProduct.productNameEn,
      cost,
      retail_cents: priceCents(cost, markup),
      weight: v.variantWeight,
    }
  })

  // Single-option product where each CJ variant becomes one Medusa variant.
  // Admin can split into multi-option products manually if a SKU calls for it.
  const { result } = await createProductsWorkflow(req.scope).run({
    input: {
      products: [
        {
          title: productTitle,
          handle: productHandle,
          description: cjProduct.description,
          thumbnail: cjProduct.productImage,
          images: cjProduct.productImageSet?.map((url) => ({ url })),
          options: [{ title: 'Variant', values: variantInputs.map((v) => v.cj_name) }],
          variants: variantInputs.map((v) => ({
            title: v.cj_name,
            sku: v.cj_sku,
            manage_inventory: true,
            weight: v.weight,
            options: { Variant: v.cj_name },
            prices: [{ currency_code, amount: v.retail_cents }],
          })),
        },
      ],
    },
  })

  const createdProduct = result[0]
  const cjModule = req.scope.resolve<CjDropshippingService>(CJ_DROPSHIPPING_MODULE)

  // Pair Medusa variants with the CJ variant inputs by index — createProductsWorkflow
  // preserves order.
  const created = (createdProduct.variants ?? []).map((mv: any, idx: number) => ({
    medusa_variant_id: mv.id,
    cj: variantInputs[idx],
  }))

  // Persist CjVariant rows + links in two steps so that link creation has
  // valid foreign keys on both sides.
  const cjVariantRows = await cjModule.createCjVariants(
    created.map((c) => ({
      cj_vid: c.cj.cj_vid,
      cj_pid: pid,
      warehouse_code: 'CA',
      cost_price: c.cj.cost,
    }))
  )

  const cjVariantsArray = Array.isArray(cjVariantRows) ? cjVariantRows : [cjVariantRows]

  await link.create(
    created.map((c, i) => ({
      [Modules.PRODUCT]: { product_variant_id: c.medusa_variant_id },
      [CJ_DROPSHIPPING_MODULE]: { cj_variant_id: cjVariantsArray[i].id },
    }))
  )

  res.json({
    product_id: createdProduct.id,
    handle: createdProduct.handle,
    variants: created.map((c, i) => ({
      medusa_variant_id: c.medusa_variant_id,
      cj_variant_id: cjVariantsArray[i].id,
      cj_vid: c.cj.cj_vid,
      retail_cents: c.cj.retail_cents,
    })),
  })
}
