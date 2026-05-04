import ProductModule from '@medusajs/medusa/product'
import { defineLink } from '@medusajs/framework/utils'
import CjDropshippingModule from '../modules/cj-dropshipping'

/**
 * Each Medusa product variant maps to at most one CJ variant.
 * The CJ variant carries the cj_vid + warehouse_code that fulfillment uses.
 */
export default defineLink(
  ProductModule.linkable.productVariant,
  CjDropshippingModule.linkable.cjVariant
)
