import { MedusaService, MedusaError } from '@medusajs/framework/utils'
import { Logger } from '@medusajs/framework/types'
import CjVariant from './models/cj-variant'
import {
  CjAccessToken,
  CjCreateOrderRequest,
  CjCreateOrderResponse,
  CjDropshippingModuleOptions,
  CjEnvelope,
  CjOrderListResponse,
  CjOrderQueryItem,
  CjProductDetail,
  CjProductList,
  CjStockResponse,
  CjTrackingResponse,
} from './types'

type InjectedDependencies = {
  logger: Logger
}

const DEFAULT_BASE_URL = 'https://developers.cjdropshipping.com/api2.0/v1'

// Refresh the access token this many ms before it expires so we never
// dispatch a request with a stale token.
const ACCESS_TOKEN_REFRESH_MARGIN_MS = 60 * 60 * 1000 // 1 hour

class CjDropshippingService extends MedusaService({ CjVariant }) {
  protected readonly logger_: Logger
  protected readonly options_: CjDropshippingModuleOptions
  protected readonly baseUrl_: string

  protected accessToken_: string | null = null
  protected accessTokenExpiresAt_: number = 0
  protected refreshToken_: string | null = null
  protected refreshTokenExpiresAt_: number = 0

  // Coalesces concurrent refresh attempts so we don't spam the auth endpoint
  // when many requests fire while the token is expired.
  protected pendingTokenRefresh_: Promise<string> | null = null

  constructor({ logger }: InjectedDependencies, options: CjDropshippingModuleOptions) {
    super(...arguments)
    this.logger_ = logger
    this.options_ = options
    this.baseUrl_ = options.baseUrl ?? DEFAULT_BASE_URL

    if (!options.apiKey) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, 'CJ_API_KEY is required for cj-dropshipping module')
    }
  }

  // ---------- Auth ----------

  /**
   * Returns a valid access token, refreshing if expired or near-expiry.
   * Public so workflows can warm the cache; most callers go through
   * request_() which calls this internally.
   */
  async getAccessToken(): Promise<string> {
    if (this.accessToken_ && Date.now() < this.accessTokenExpiresAt_ - ACCESS_TOKEN_REFRESH_MARGIN_MS) {
      return this.accessToken_
    }

    if (this.pendingTokenRefresh_) {
      return this.pendingTokenRefresh_
    }

    this.pendingTokenRefresh_ = this.acquireToken_().finally(() => {
      this.pendingTokenRefresh_ = null
    })
    return this.pendingTokenRefresh_
  }

  private async acquireToken_(): Promise<string> {
    // Prefer refresh if we have a non-expired refresh token; otherwise login.
    const canRefresh = this.refreshToken_ && Date.now() < this.refreshTokenExpiresAt_
    const path = canRefresh ? '/authentication/refreshAccessToken' : '/authentication/getAccessToken'
    const body = canRefresh ? { refreshToken: this.refreshToken_ } : { apiKey: this.options_.apiKey }

    const res = await fetch(`${this.baseUrl_}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    const json = (await res.json()) as CjEnvelope<CjAccessToken>
    if (!res.ok || !json.result || !json.data?.accessToken) {
      // Login can fail because the refresh token expired silently — fall
      // back to apiKey login once before giving up.
      if (canRefresh) {
        this.refreshToken_ = null
        this.refreshTokenExpiresAt_ = 0
        return this.acquireToken_()
      }
      throw new MedusaError(
        MedusaError.Types.UNAUTHORIZED,
        `CJ auth failed: ${json.message ?? res.statusText}`
      )
    }

    this.accessToken_ = json.data.accessToken
    this.accessTokenExpiresAt_ = new Date(json.data.accessTokenExpiryDate).getTime()
    this.refreshToken_ = json.data.refreshToken
    this.refreshTokenExpiresAt_ = new Date(json.data.refreshTokenExpiryDate).getTime()

    this.logger_.info(`CJ access token acquired, expires ${json.data.accessTokenExpiryDate}`)
    return this.accessToken_
  }

  // ---------- Request helper ----------

  private async request_<T>(
    method: 'GET' | 'POST',
    path: string,
    params?: Record<string, unknown>,
    body?: unknown
  ): Promise<T> {
    const token = await this.getAccessToken()

    let url = `${this.baseUrl_}${path}`
    if (params && Object.keys(params).length) {
      const qs = new URLSearchParams()
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null) qs.set(k, String(v))
      }
      url += `?${qs.toString()}`
    }

    const res = await fetch(url, {
      method,
      headers: {
        'CJ-Access-Token': token,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    })

    const text = await res.text()
    let json: CjEnvelope<T>
    try {
      json = JSON.parse(text) as CjEnvelope<T>
    } catch {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `CJ ${method} ${path} returned non-JSON (${res.status}): ${text.slice(0, 200)}`
      )
    }

    if (res.status >= 500) {
      // Surface as transient — workflow step retry will pick this up.
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `CJ ${method} ${path} 5xx: ${json.message ?? res.statusText}`
      )
    }
    if (!res.ok || !json.result) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `CJ ${method} ${path} failed (${json.code}): ${json.message ?? res.statusText}`
      )
    }
    return json.data
  }

  // ---------- Catalog / inventory ----------

  async searchProducts(query: string, page = 1, pageSize = 20): Promise<CjProductList> {
    return this.request_<CjProductList>('GET', '/product/list', {
      productNameEn: query,
      pageNum: page,
      pageSize,
      countryCode: this.options_.warehouseCode,
    })
  }

  async getProduct(pid: string): Promise<CjProductDetail> {
    return this.request_<CjProductDetail>('GET', '/product/query', { pid })
  }

  /**
   * Returns stock entries across all warehouses CJ has the variant in. The
   * caller filters to the configured warehouse code via stockForWarehouse().
   */
  async getStock(vid: string): Promise<CjStockResponse> {
    return this.request_<CjStockResponse>('GET', '/product/stock/queryByVid', { vid })
  }

  stockForWarehouse(stock: CjStockResponse, warehouseCode = this.options_.warehouseCode): number {
    const entry = stock.find((s) => s.countryCode === warehouseCode)
    return entry?.storageNum ?? 0
  }

  // ---------- Orders ----------

  /**
   * Idempotent create. Looks up the order by customerOrderNumber first; if
   * one already exists with that number, returns it instead of creating a
   * duplicate. The caller passes the Medusa order ID as customerOrderNumber.
   */
  async createOrder(payload: CjCreateOrderRequest): Promise<CjCreateOrderResponse> {
    const existing = await this.findOrderByCustomerNumber(payload.customerOrderNumber)
    if (existing) {
      this.logger_.info(`CJ order already exists for customerOrderNumber=${payload.customerOrderNumber} (cjOrderId=${existing.orderId}) — skipping create`)
      return { orderId: existing.orderId, orderNum: existing.orderNum }
    }

    return this.request_<CjCreateOrderResponse>('POST', '/shopping/order/createOrder', undefined, {
      ...payload,
      fromCountryCode: payload.fromCountryCode ?? this.options_.warehouseCode,
    })
  }

  async findOrderByCustomerNumber(customerOrderNumber: string): Promise<CjOrderQueryItem | null> {
    const list = await this.request_<CjOrderListResponse>('GET', '/shopping/order/list', {
      customerOrderNumber,
      pageNum: 1,
      pageSize: 1,
    })
    return list.list?.[0] ?? null
  }

  async getOrder(orderId: string): Promise<CjOrderQueryItem> {
    return this.request_<CjOrderQueryItem>('GET', '/shopping/order/query', { orderId })
  }

  // ---------- Tracking ----------

  async getTracking(trackNumber: string): Promise<CjTrackingResponse> {
    return this.request_<CjTrackingResponse>('GET', '/logistic/trackInfo', { trackNumber })
  }
}

export default CjDropshippingService
