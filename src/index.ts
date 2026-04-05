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
  ComgateLanguage,
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
export {
  PaymentError,
  COMGATE_API_URL,
  createAuthHeader,
  createPayment,
  getPaymentStatus,
  MOCK_MERCHANT_ID,
  MOCK_SECRET,
  isMockMode,
  isMockTransactionId,
} from './utils'
