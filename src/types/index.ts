// Config types
export type {
  ComgateAdapterArgs,
  ComgateAdapterClientArgs,
  ComgateCartContext,
  ComgateCartLike,
  ComgateConnectionCredentials,
  ComgateCurrency,
  ComgateItemPricing,
  ComgateItemPricingResolver,
  ComgateLanguage,
  ComgateOrderContext,
} from './config'

// API types
export type {
  ComgateCategory,
  ComgateCreateResponse,
  ComgateCustomerDetails,
  ComgateDelivery,
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
  /**
   * Comgate `transId`. Returned so an in-page Checkout SDK can drive the wallet
   * sheet without a redirect; the redirect flow ignores it (Comgate appends the
   * same value to the return URL anyway).
   */
  gatewayTransactionId?: string
}

/**
 * Return type from confirmOrder
 */
export interface ConfirmOrderReturnType {
  message: string
  orderID: string | number
  transactionID: string | number
}
