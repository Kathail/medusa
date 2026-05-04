import { createStep, createWorkflow, StepResponse, WorkflowResponse } from '@medusajs/framework/workflows-sdk'
import { ContainerRegistrationKeys, MedusaError, Modules } from '@medusajs/framework/utils'

type Input = {
  // We use customerOrderNumber == medusa_order_id, so the webhook hands
  // us the Medusa order ID directly. Falling back to cj_order_id lookup
  // is supported via the metadata path.
  medusa_order_id?: string
  cj_order_id?: string
  track_number: string
  carrier: string
  ship_date?: string
}

const resolveOrderStep = createStep(
  'resolve-order-for-tracking',
  async (input: Input, { container }) => {
    if (input.medusa_order_id) {
      return new StepResponse({ order_id: input.medusa_order_id })
    }

    if (!input.cj_order_id) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        'update-cj-tracking requires either medusa_order_id or cj_order_id'
      )
    }

    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const { data: orders } = await query.graph({
      entity: 'order',
      fields: ['id'],
      // Postgres JSONB containment via the metadata column.
      filters: { metadata: { cj_order_id: input.cj_order_id } } as any,
    })

    const order = orders[0]
    if (!order) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `No Medusa order found with metadata.cj_order_id=${input.cj_order_id}`
      )
    }
    return new StepResponse({ order_id: order.id })
  }
)

const recordShipmentStep = createStep(
  {
    name: 'record-cj-shipment',
    maxRetries: 3,
    retryInterval: 5,
  },
  async (
    input: { order_id: string; track_number: string; carrier: string; ship_date?: string },
    { container }
  ) => {
    const orderModule = container.resolve(Modules.ORDER)
    const eventBus = container.resolve(Modules.EVENT_BUS)

    // Persist tracking data on the order's metadata so the admin UI surfaces
    // it even before a formal Fulfillment record is wired up.
    //
    // TODO: replace with createOrderShipmentWorkflow once we standardize on
    // a fulfillment provider. That workflow emits shipment.created itself,
    // so we'd remove the manual emit below.
    await orderModule.updateOrders([
      {
        id: input.order_id,
        metadata: {
          cj_track_number: input.track_number,
          cj_carrier: input.carrier,
          cj_ship_date: input.ship_date ?? new Date().toISOString(),
        },
      } as any,
    ])

    await eventBus.emit({
      name: 'shipment.created',
      data: {
        order_id: input.order_id,
        track_number: input.track_number,
        carrier: input.carrier,
      },
    })

    return new StepResponse({ order_id: input.order_id })
  }
)

const updateCjTrackingWorkflow = createWorkflow(
  'update-cj-tracking',
  (input: Input) => {
    const resolved = resolveOrderStep(input)
    const result = recordShipmentStep({
      order_id: resolved.order_id,
      track_number: input.track_number,
      carrier: input.carrier,
      ship_date: input.ship_date,
    })
    return new WorkflowResponse(result)
  }
)

export default updateCjTrackingWorkflow
