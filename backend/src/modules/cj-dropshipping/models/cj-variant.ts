import { model } from '@medusajs/framework/utils'

// After merge: pnpm medusa db:generate cj-dropshipping && pnpm medusa db:migrate
const CjVariant = model.define('cj_variant', {
  id: model.id().primaryKey(),
  cj_vid: model.text().unique(),
  cj_pid: model.text(),
  warehouse_code: model.text(),
  // CJ wholesale cost in minor currency units (cents). Stored as integer
  // to match Medusa's pricing convention and to avoid float drift.
  cost_price: model.number(),
  last_synced_stock: model.number().nullable(),
  last_synced_at: model.dateTime().nullable(),
})

export default CjVariant
