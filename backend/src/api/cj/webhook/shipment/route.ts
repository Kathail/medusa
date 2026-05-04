import { MedusaRequest, MedusaResponse } from '@medusajs/framework'
import crypto from 'crypto'
import { CJ_WEBHOOK_SECRET } from '../../../../lib/constants'
import updateCjTrackingWorkflow from '../../../../workflows/update-cj-tracking'
import type { CjShipmentWebhookPayload } from '../../../../modules/cj-dropshipping/types'

/**
 * TODO(cj-webhook-signature): The exact header name and HMAC scheme used
 * by CJ Dropshipping must be confirmed against the current developer
 * portal docs before this webhook is registered with CJ. The implementation
 * below assumes:
 *   - Header: `cj-signature`
 *   - Algorithm: HMAC-SHA256 of the raw JSON body, hex-encoded
 *   - Shared secret: CJ_WEBHOOK_SECRET (configured in CJ portal + env)
 *
 * Until verified, leave the webhook URL unregistered in CJ. The route still
 * works for unsigned development calls if CJ_WEBHOOK_SECRET is unset.
 */
function verifyCjSignature(rawBody: string, header: string | undefined, secret: string): boolean {
  if (!header) return false
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
  const a = Buffer.from(expected)
  const b = Buffer.from(header)
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  // req.body is JSON-parsed by Medusa's default body parser. For accurate
  // HMAC verification we should compare against the raw bytes; configuring
  // raw-body capture for this route is a follow-up (TODO above).
  const rawBody = JSON.stringify(req.body)

  if (CJ_WEBHOOK_SECRET) {
    const sigHeader = (req.headers['cj-signature'] || req.headers['x-cj-signature']) as string | undefined
    if (!verifyCjSignature(rawBody, sigHeader, CJ_WEBHOOK_SECRET)) {
      res.status(401).json({ error: 'invalid signature' })
      return
    }
  }

  const payload = req.body as CjShipmentWebhookPayload
  if (!payload?.trackNumber || !payload?.logisticName) {
    res.status(400).json({ error: 'trackNumber and logisticName required' })
    return
  }

  // We sent customerOrderNumber == medusa_order_id when creating the CJ
  // order; CJ echoes it back on the webhook.
  await updateCjTrackingWorkflow(req.scope).run({
    input: {
      medusa_order_id: payload.customerOrderNumber,
      cj_order_id: payload.orderId,
      track_number: payload.trackNumber,
      carrier: payload.logisticName,
      ship_date: payload.shipDate,
    },
  })

  res.status(200).json({ received: true })
}
