import { MedusaContainer } from '@medusajs/framework/types'
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils'
import { CJ_DROPSHIPPING_MODULE } from '../modules/cj-dropshipping'
import type CjDropshippingService from '../modules/cj-dropshipping/service'

const BATCH_SIZE = 50
// CJ rate-limits at ~1 req/sec; we add a small margin.
const REQ_DELAY_MS = 1100

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export default async function syncCjInventoryJob(container: MedusaContainer): Promise<void> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const cj = container.resolve<CjDropshippingService>(CJ_DROPSHIPPING_MODULE)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const inventory = container.resolve(Modules.INVENTORY)

  let offset = 0
  let totalUpdated = 0
  let totalErrors = 0

  // Outer loop paginates CjVariant rows; inner loop processes each batch
  // serially to honor CJ's rate limit.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const cjVariants = await cj.listCjVariants({}, { take: BATCH_SIZE, skip: offset })
    if (!cjVariants.length) break

    // Pull linked Medusa variant IDs + inventory item IDs in one query.
    const cjVariantIds = cjVariants.map((c: any) => c.id)
    const { data: links } = await query.graph({
      entity: 'cj_variant',
      fields: [
        'id',
        'cj_vid',
        'warehouse_code',
        'product_variant.id',
        'product_variant.inventory_items.inventory.id',
      ],
      filters: { id: cjVariantIds },
    })
    const linkByCjVariantId: Record<string, any> = Object.fromEntries(
      links.map((l: any) => [l.id, l])
    )

    for (const cjVariant of cjVariants) {
      try {
        const stock = await cj.getStock(cjVariant.cj_vid)
        const stocked = cj.stockForWarehouse(stock, cjVariant.warehouse_code)

        const link = linkByCjVariantId[cjVariant.id]
        const inventoryItemId =
          link?.product_variant?.inventory_items?.[0]?.inventory?.id

        if (!inventoryItemId) {
          logger.warn(`No inventory item for CJ variant ${cjVariant.cj_vid} — skipping`)
          continue
        }

        // Update every level on this inventory item. For a single-warehouse
        // setup this is one row; for multi-warehouse the assumption is the
        // CJ warehouse code matches the Medusa stock location code.
        const levels = await inventory.listInventoryLevels({ inventory_item_id: inventoryItemId })
        for (const lvl of levels) {
          await inventory.updateInventoryLevels([
            {
              inventory_item_id: inventoryItemId,
              location_id: lvl.location_id,
              stocked_quantity: stocked,
            },
          ])
        }

        await cj.updateCjVariants([
          {
            id: cjVariant.id,
            last_synced_stock: stocked,
            last_synced_at: new Date(),
          } as any,
        ])

        totalUpdated++
      } catch (err: any) {
        totalErrors++
        logger.error(`CJ stock sync failed for ${cjVariant.cj_vid}: ${err?.message ?? err}`)
      }

      await sleep(REQ_DELAY_MS)
    }

    if (cjVariants.length < BATCH_SIZE) break
    offset += BATCH_SIZE
  }

  logger.info(`CJ inventory sync complete: ${totalUpdated} updated, ${totalErrors} errors`)
}

export const config = {
  name: 'sync-cj-inventory',
  schedule: '0 * * * *',
}
