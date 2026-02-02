/**
 * Comgate API response for payment creation
 */
export interface ComgateCreateResponse {
  /**
   * Response code (0 = success)
   */
  code: number

  /**
   * Response message
   */
  message: string

  /**
   * Comgate transaction ID (only on success)
   */
  transId?: string

  /**
   * Redirect URL for customer payment page (only on success)
   */
  redirect?: string
}

/**
 * Comgate API response for payment status check
 */
export interface ComgateStatusResponse {
  /**
   * Response code (0 = success)
   */
  code: number

  /**
   * Response message
   */
  message: string

  /**
   * Test mode indicator
   */
  test?: string

  /**
   * Payment amount in cents/smallest currency unit
   */
  price?: string

  /**
   * Currency code
   */
  curr?: string

  /**
   * Payment label
   */
  label?: string

  /**
   * Reference ID (your transaction ID)
   */
  refId?: string

  /**
   * Customer email
   */
  email?: string

  /**
   * Comgate transaction ID
   */
  transId?: string

  /**
   * Payment status
   * - PENDING: Waiting for payment
   * - PAID: Successfully paid
   * - CANCELLED: Cancelled by user
   * - AUTHORIZED: Preauthorized (if preauth enabled)
   */
  status?: 'PENDING' | 'PAID' | 'CANCELLED' | 'AUTHORIZED' | string

  /**
   * Transaction fee charged by Comgate
   */
  fee?: string

  /**
   * Payer name from payment method
   */
  payerName?: string

  /**
   * Payer account/card info
   */
  payerAcc?: string
}

/**
 * Comgate webhook/STATUS URL payload
 */
export interface ComgateWebhookPayload {
  /**
   * Merchant ID
   */
  merchant: string

  /**
   * Test mode indicator
   */
  test: string

  /**
   * Payment amount in cents
   */
  price: string

  /**
   * Currency code
   */
  curr: string

  /**
   * Payment label
   */
  label: string

  /**
   * Reference ID (your transaction ID)
   */
  refId: string

  /**
   * Comgate transaction ID
   */
  transId: string

  /**
   * Customer email
   */
  email: string

  /**
   * Payment status
   */
  status: string

  /**
   * Transaction fee
   */
  fee?: string

  /**
   * Payment method used
   */
  method?: string

  /**
   * Payer account info
   */
  payerAcc?: string

  /**
   * Payer name
   */
  payerName?: string
}

/**
 * Payment request body sent to Comgate API
 */
export interface ComgatePaymentRequest {
  test: boolean
  country: string
  price: number
  curr: string
  label: string
  refId: string
  method: string
  email: string
  lang: string
  preauth: boolean
  returnUrl: string
}
