import { MedusaRequest, MedusaResponse } from '@medusajs/framework'
import { ContainerRegistrationKeys, MedusaError } from '@medusajs/framework/utils'
import { CJ_DROPSHIPPING_MODULE } from '../../../../modules/cj-dropshipping'
import type CjDropshippingService from '../../../../modules/cj-dropshipping/service'

// CJ rate-limits at ~1 req/sec; pad slightly to avoid 1600200 retries.
const STOCK_CALL_DELAY_MS = 1100

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * GET /admin/cj/preview?pid=<cj_pid>
 *
 * Returns the CJ product detail plus a per-variant warehouse stock
 * breakdown so an admin can see where each variant ships from before
 * deciding to import. Calls /product/query once and /product/stock/queryByVid
 * once per variant (serially, throttled), so a product with N variants
 * takes ~N seconds.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  const cj = req.scope.resolve<CjDropshippingService>(CJ_DROPSHIPPING_MODULE)

  const pid = req.query.pid as string | undefined
  if (!pid) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, 'pid query param is required')
  }

  const product = await cj.getProduct(pid)
  if (!product.variants?.length) {
    res.json({
      pid: product.pid,
      name: product.productNameEn,
      image: product.productImage,
      images: product.productImageSet ?? [],
      description: product.description,
      variants: [],
    })
    return
  }

  const variants: Array<{
    vid: string
    name: string
    sku?: string
    sellPrice: string
    weight?: number
    stock: Array<{ countryCode: string; areaEn: string; storageNum: number }>
    stockError?: string
  }> = []

  for (let i = 0; i < product.variants.length; i++) {
    const v = product.variants[i]
    if (i > 0) await sleep(STOCK_CALL_DELAY_MS)

    let stock: Array<{ countryCode: string; areaEn: string; storageNum: number }> = []
    let stockError: string | undefined
    try {
      const raw = await cj.getStock(v.vid)
      stock = raw.map((s) => ({
        countryCode: s.countryCode,
        areaEn: s.areaEn,
        storageNum: s.storageNum,
      }))
    } catch (err: any) {
      stockError = err?.message ?? String(err)
      logger.warn(`Stock lookup failed for vid=${v.vid}: ${stockError}`)
    }

    variants.push({
      vid: v.vid,
      name: v.variantNameEn ?? product.productNameEn,
      sku: v.variantSku,
      sellPrice: v.variantSellPrice,
      weight: v.variantWeight,
      stock,
      ...(stockError ? { stockError } : {}),
    })
  }

  res.json({
    pid: product.pid,
    name: product.productNameEn,
    image: product.productImage,
    images: product.productImageSet ?? [],
    description: product.description,
    variants,
  })
}
