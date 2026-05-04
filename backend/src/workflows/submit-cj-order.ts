import { createStep, createWorkflow, StepResponse, WorkflowResponse } from '@medusajs/framework/workflows-sdk'
import { ContainerRegistrationKeys, MedusaError, Modules } from '@medusajs/framework/utils'
import { cancelOrderWorkflow } from '@medusajs/medusa/core-flows'
import { CJ_DROPSHIPPING_MODULE } from '../modules/cj-dropshipping'
import type CjDropshippingService from '../modules/cj-dropshipping/service'
import type { CjCreateOrderRequest, CjOrderProduct } from '../modules/cj-dropshipping/types'

type Input = {
  order_id: string
}

type LoadedOrder = {
  id: string
  email: string
  shipping_address: {
    first_name?: string | null
    last_name?: string | null
    address_1: string
    address_2?: string | null
    city: string
    province?: string | null
    postal_code: string
    country_code: string
    phone?: string | null
  }
  items: Array<{
    id: string
    variant_id: string
    quantity: number
    cj_vid: string
    cj_variant_warehouse: string
  }>
}

const loadOrderForCjStep = createStep(
  'load-order-for-cj',
  async ({ order_id }: Input, { container }) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)

    const { data: orders } = await query.graph({
      entity: 'order',
      fields: [
        'id',
        'email',
        'shipping_address.*',
        'items.id',
        'items.variant_id',
        'items.quantity',
        'items.variant.cj_variant.cj_vid',
        'items.variant.cj_variant.warehouse_code',
      ],
      filters: { id: order_id },
    })

    const order = orders[0]
    if (!order) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, `Order ${order_id} not found`)
    }
    if (!order.shipping_address) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, `Order ${order_id} has no shipping address`)
    }

    const items = (order.items ?? []).map((it: any) => {
      const cjLink = it.variant?.cj_variant
      if (!cjLink?.cj_vid) {
        // Non-CJ items are out of scope for this integration.
        // Throw so we don't silently submit a partial order.
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `Order ${order_id} line item ${it.id} (variant ${it.variant_id}) has no linked CJ variant`
        )
      }
      return {
        id: it.id,
        variant_id: it.variant_id,
        quantity: it.quantity,
        cj_vid: cjLink.cj_vid,
        cj_variant_warehouse: cjLink.warehouse_code,
      }
    })

    return new StepResponse<LoadedOrder>({
      id: order.id,
      email: order.email!,
      shipping_address: order.shipping_address as any,
      items,
    })
  }
)

const submitCjOrderStep = createStep(
  {
    name: 'submit-cj-order',
    // Transient errors (5xx, network) are retried; INVALID_DATA (e.g. OOS,
    // bad address) is thrown by the service and not retried by default.
    maxRetries: 3,
    retryInterval: 5,
  },
  async (order: LoadedOrder, { container }) => {
    const cj = container.resolve<CjDropshippingService>(CJ_DROPSHIPPING_MODULE)

    const products: CjOrderProduct[] = order.items.map((it) => ({
      vid: it.cj_vid,
      quantity: it.quantity,
    }))

    const fullName = [order.shipping_address.first_name, order.shipping_address.last_name]
      .filter(Boolean)
      .join(' ')
      .trim() || order.email

    const payload: CjCreateOrderRequest = {
      // Medusa order ID doubles as customerOrderNumber for idempotency.
      customerOrderNumber: order.id,
      shippingCountryCode: order.shipping_address.country_code.toUpperCase(),
      shippingProvince: order.shipping_address.province ?? '',
      shippingCity: order.shipping_address.city,
      shippingAddress: order.shipping_address.address_1,
      shippingAddress2: order.shipping_address.address_2 ?? undefined,
      shippingZip: order.shipping_address.postal_code,
      shippingCustomerName: fullName,
      shippingPhone: order.shipping_address.phone ?? '',
      email: order.email,
      products,
      remark: `Medusa order ${order.id}`,
    }

    const result = await cj.createOrder(payload)
    return new StepResponse(result, { medusa_order_id: order.id, cj_order_id: result.orderId })
  }
)

const persistCjOrderIdStep = createStep(
  'persist-cj-order-id',
  async (
    input: { medusa_order_id: string; cj_order_id: string; cj_order_num?: string },
    { container }
  ) => {
    const orderModule = container.resolve(Modules.ORDER)
    await orderModule.updateOrders([
      {
        id: input.medusa_order_id,
        metadata: {
          cj_order_id: input.cj_order_id,
          cj_order_num: input.cj_order_num ?? null,
        },
      } as any,
    ])
    return new StepResponse(undefined)
  }
)

const submitCjOrderWorkflow = createWorkflow(
  'submit-cj-order',
  (input: Input) => {
    const order = loadOrderForCjStep(input)
    const cjResult = submitCjOrderStep(order)
    persistCjOrderIdStep({
      medusa_order_id: input.order_id,
      cj_order_id: cjResult.orderId,
      cj_order_num: cjResult.orderNum,
    })
    return new WorkflowResponse(cjResult)
  }
)

export default submitCjOrderWorkflow

/**
 * Helper for the order-placed subscriber: runs the workflow, and on
 * non-retryable failure (e.g. CJ out-of-stock) cancels the Medusa order
 * with a refund so the customer isn't charged for an unfulfillable cart.
 *
 * Kept out of the workflow itself because cancellation has its own
 * compensable side-effects we don't want entangled with the submit retry.
 */
export async function submitCjOrderWithFallback(
  container: any,
  input: Input
): Promise<void> {
  try {
    await submitCjOrderWorkflow(container).run({ input })
  } catch (err: any) {
    const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
    logger.error(`CJ order submission failed for ${input.order_id}: ${err?.message}`)
    await cancelOrderWorkflow(container).run({
      input: {
        order_id: input.order_id,
        // canceled_by/internal_note pattern depends on Medusa version; the
        // workflow accepts a free-form metadata bag.
      } as any,
    })
    // Re-throw so the subscriber surfaces the error in logs.
    throw err
  }
}
