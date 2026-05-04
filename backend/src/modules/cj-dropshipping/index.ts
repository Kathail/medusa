import { Module } from '@medusajs/framework/utils'
import CjDropshippingService from './service'

export const CJ_DROPSHIPPING_MODULE = 'cj_dropshipping'

export default Module(CJ_DROPSHIPPING_MODULE, {
  service: CjDropshippingService,
})
