/**
 * Comgate payment adapter for PayloadCMS
 *
 * @packageDocumentation
 */

// Main adapter
export { comgateAdapter } from './comgateAdapter'

// Types
export type {
  ComgateAdapterArgs,
  ComgateAdapterClientArgs,
  ComgateCartContext,
  ComgateCartLike,
  ComgateCategory,
  ComgateCurrency,
  ComgateCustomerDetails,
  ComgateDelivery,
  ComgateItemPricing,
  ComgateItemPricingResolver,
  ComgateLanguage,
  ComgateOrderContext,
  ComgateCreateResponse,
  ComgateStatusResponse,
  ComgateWebhookPayload,
  ComgatePaymentRequest,
  InitiatePaymentReturnType,
  ConfirmOrderReturnType,
} from './types'

// Refund
export { refundPayment } from './refund'
export type { RefundResult, RefundConfig } from './refund'

// Utils (for advanced usage)
//
// NOTE: `MOCK_MERCHANT_ID` / `MOCK_SECRET` are intentionally NOT
// re-exported from the public API (audit P1). Consumers should switch
// to `PAYMENT_MOCK_MODE=true` env var (or adapter `mode: 'mock'`)
// instead of string-literal credentials. Tests inside this package
// that still need the literals import them from `./utils/mock`.
export {
  PaymentError,
  COMGATE_API_URL,
  buildCustomerDetails,
  createAuthHeader,
  createPayment,
  getAppleDomainAssociation,
  getPaymentStatus,
  isMockMode,
  isMockTransactionId,
} from './utils'
export type { BuildCustomerDetailsArgs } from './utils'
