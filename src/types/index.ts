// Config types
export type { ComgateAdapterArgs, ComgateAdapterClientArgs, ComgateLanguage } from './config'

// API types
export type {
  ComgateCreateResponse,
  ComgateStatusResponse,
  ComgateWebhookPayload,
  ComgatePaymentRequest,
} from './api'

/**
 * Return type from initiatePayment
 */
export interface InitiatePaymentReturnType {
  message: string
  redirect?: string
  transactionID: string | number
}

/**
 * Return type from confirmOrder
 */
export interface ConfirmOrderReturnType {
  message: string
  orderID: string | number
  transactionID: string | number
}
