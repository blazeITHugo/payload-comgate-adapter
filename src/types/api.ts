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
 * How the goods reach the customer. Feeds Comgate's 3DS2 / AML payload.
 * @see https://apidoc.comgate.cz/en/api/post/
 */
export type ComgateDelivery = 'HOME_DELIVERY' | 'PICKUP' | 'ELECTRONIC_DELIVERY'

/**
 * Order-content category for the 3DS2 payload.
 */
export type ComgateCategory = 'PHYSICAL_GOODS_ONLY' | 'OTHER'

/**
 * Optional customer / order detail sent alongside the payment.
 *
 * Comgate forwards these to the issuer as part of the 3DS2 authentication
 * request: the more of them are populated, the more likely the issuer's risk
 * engine grants a *frictionless* flow instead of challenging the payer (every
 * challenge is a drop-off risk). They also populate the payment detail in the
 * Comgate portal — which is what support and dispute handling read — and feed
 * Comgate's AML checks.
 *
 * Every field is optional and is omitted when there is no usable value; a
 * missing or malformed detail must never fail payment creation.
 */
export interface ComgateCustomerDetails {
  /** Payer's full name (given + family). */
  fullName?: string
  /** Payer phone in international (E.164) format, e.g. `+421900123456`. */
  phone?: string
  billingAddrCity?: string
  billingAddrStreet?: string
  billingAddrPostalCode?: string
  /** ISO 3166-1 alpha-2. */
  billingAddrCountry?: string
  delivery?: ComgateDelivery
  /** Delivery address — only meaningful when `delivery === 'HOME_DELIVERY'`. */
  homeDeliveryCity?: string
  homeDeliveryStreet?: string
  homeDeliveryPostalCode?: string
  /** ISO 3166-1 alpha-2. */
  homeDeliveryCountry?: string
  category?: ComgateCategory
  /** Product identifier shown as "Produkt" in the portal, used for statistics. */
  name?: string
}

/**
 * Payment request body sent to Comgate API
 */
export interface ComgatePaymentRequest extends ComgateCustomerDetails {
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
  /**
   * Where Comgate sends the payer when they cancel / the payment fails.
   * Without it every outcome lands on `returnUrl` (the confirm-order page),
   * which then has to fail a confirm call before redirecting on.
   */
  cancelUrl?: string
  /**
   * Where Comgate sends the payer while the payment is still pending
   * (deferred methods — bank transfer etc.). Defaults to `returnUrl`.
   */
  pendingUrl?: string
  /**
   * When 'Y', the customer's card is enrolled for recurring billing and
   * Comgate returns a `payerAcc` token on the create/status response.
   * Used for first-payment of subscription orders. Subsequent recurring
   * charges send `initRecurring: 'N'` plus the stored `payerAcc`.
   */
  initRecurring?: 'Y' | 'N'
}
