import { MedusaRequest, MedusaResponse } from '@medusajs/framework'
import { CJ_DROPSHIPPING_MODULE } from '../../../../modules/cj-dropshipping'
import type CjDropshippingService from '../../../../modules/cj-dropshipping/service'

export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const cj = req.scope.resolve<CjDropshippingService>(CJ_DROPSHIPPING_MODULE)

  const q = (req.query.q as string | undefined) ?? ''
  const page = Math.max(1, parseInt((req.query.page as string | undefined) ?? '1', 10))
  const pageSize = Math.min(50, parseInt((req.query.pageSize as string | undefined) ?? '20', 10))
  // Optional ISO country code filter (e.g. 'CA', 'US'). Default: full catalog.
  const countryCode = (req.query.countryCode as string | undefined)?.toUpperCase()

  const result = await cj.searchProducts(q, page, pageSize, countryCode)

  res.json({
    page: result.pageNum,
    pageSize: result.pageSize,
    total: result.total,
    countryCode: countryCode ?? null,
    items: result.list.map((p) => ({
      pid: p.pid,
      name: p.productNameEn,
      sku: p.productSku,
      image: p.productImage,
      sellPrice: p.sellPrice,
      categoryName: p.categoryName,
    })),
  })
}
