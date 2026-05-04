import { SubscriberArgs, SubscriberConfig } from '@medusajs/medusa'
import { submitCjOrderWithFallback } from '../workflows/submit-cj-order'

/**
 * Distinct file from `order-placed.ts` (the email subscriber). Medusa runs
 * each subscriber file independently for the same event, so the two coexist.
 */
export default async function orderPlacedCjHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  await submitCjOrderWithFallback(container, { order_id: data.id })
}

export const config: SubscriberConfig = {
  event: 'order.placed',
  context: { subscriberId: 'order-placed-cj' },
}
