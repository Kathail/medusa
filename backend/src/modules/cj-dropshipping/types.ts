/**
 * CJ Dropshipping API types.
 *
 * These cover only the fields we read or send. CJ's responses contain many
 * more keys — extending this file is fine, but every field added should be
 * one we actually use.
 *
 * All endpoints wrap their payload in { result, code, message, data }.
 */

export type CjEnvelope<T> = {
  result: boolean
  code: number
  message: string
  data: T
  requestId?: string
}

export type CjAccessToken = {
  accessToken: string
  accessTokenExpiryDate: string
  refreshToken: string
  refreshTokenExpiryDate: string
  createDate?: string
}

export type CjProductListItem = {
  pid: string
  productNameEn: string
  productSku?: string
  productImage?: string
  sellPrice?: string
  categoryName?: string
  countryCode?: string
}

export type CjProductList = {
  list: CjProductListItem[]
  pageNum: number
  pageSize: number
  total: number
}

export type CjProductVariantDetail = {
  vid: string
  variantNameEn?: string
  variantSku?: string
  variantImage?: string
  variantSellPrice: string
  variantWeight?: number
  variantLength?: number
  variantWidth?: number
  variantHeight?: number
}

export type CjProductDetail = {
  pid: string
  productNameEn: string
  productSku?: string
  productImage?: string
  productImageSet?: string[]
  productWeight?: number
  description?: string
  variants: CjProductVariantDetail[]
}

export type CjStockEntry = {
  vid: string
  countryCode: string
  areaEn: string
  storageNum: number
}

// CJ returns stock as an array — one entry per warehouse the variant is in.
export type CjStockResponse = CjStockEntry[]

export type CjOrderProduct = {
  vid: string
  quantity: number
  shippingName?: string
}

export type CjShippingAddress = {
  shippingCountryCode: string
  shippingProvince: string
  shippingCity: string
  shippingAddress: string
  shippingAddress2?: string
  shippingZip: string
  shippingCustomerName: string
  shippingPhone: string
  email?: string
}

export type CjCreateOrderRequest = CjShippingAddress & {
  // We use the Medusa order ID here for idempotency — see service.createOrder().
  customerOrderNumber: string
  fromCountryCode?: string // 'CA' for Canadian warehouses
  remark?: string
  products: CjOrderProduct[]
  logisticName?: string
}

export type CjCreateOrderResponse = {
  orderId: string
  orderNum?: string
  orderAmount?: number
}

export type CjOrderQueryItem = {
  orderId: string
  orderNum: string
  customerOrderNumber?: string
  orderStatus: string
  trackNumber?: string
  logisticName?: string
}

export type CjOrderListResponse = {
  list: CjOrderQueryItem[]
  pageNum: number
  pageSize: number
  total: number
}

export type CjTrackingDetailItem = {
  trackDescription: string
  trackDate: string
  trackLocation?: string
}

export type CjTrackingResponse = {
  trackNumber: string
  trackingDetailList: CjTrackingDetailItem[]
}

export type CjShipmentWebhookPayload = {
  // Field names below are best-effort — verify against CJ portal docs before
  // enabling the webhook.
  orderId: string
  customerOrderNumber?: string
  trackNumber: string
  logisticName: string
  shipDate?: string
}

export type CjDropshippingModuleOptions = {
  apiKey: string
  warehouseCode: string
  webhookSecret?: string
  baseUrl?: string
}
