import type {
  PaymentAdapterArgs,
  PaymentAdapterClientArgs,
} from '@payloadcms/plugin-ecommerce/types'

/**
 * Supported Comgate payment page languages (ISO 639-1)
 * @see https://help.comgate.cz/docs/en/currencies-and-languages
 */
export type ComgateLanguage =
  | 'cs'
  | 'sk'
  | 'en'
  | 'pl'
  | 'hu'
  | 'ro'
  | 'de'
  | 'fr'
  | 'es'
  | 'it'
  | 'hr'
  | 'sl'
  | 'no'
  | 'sv'

/**
 * Supported Comgate currencies (ISO 4217)
 * Non-CZK currencies may require activation via Comgate support
 * (bank statement proving account can accept the currency).
 * @see https://help.comgate.cz/docs/en/currencies-and-languages
 */
export type ComgateCurrency =
  | 'CZK'
  | 'EUR'
  | 'PLN'
  | 'HUF'
  | 'USD'
  | 'GBP'
  | 'RON'
  | 'NOK'
  | 'SEK'

/**
 * Server-side Comgate adapter configuration
 */
export interface ComgateAdapterArgs extends PaymentAdapterArgs {
  /**
   * Comgate merchant ID (6-digit number)
   * Get this from https://portal.comgate.cz
   */
  merchantId: string

  /**
   * Comgate API secret
   * Get this from https://portal.comgate.cz
   */
  secret: string

  /**
   * Enable Comgate test mode
   * When true, payments are processed in test/sandbox environment
   * @default false
   */
  testMode?: boolean

  /**
   * Default country code (ISO 3166-1 alpha-2)
   * Used for payment method filtering
   * @default 'CZ'
   */
  country?: string

  /**
   * Payment page language
   * @default 'cs'
   */
  lang?: ComgateLanguage

  /**
   * Enable preauthorization mode
   * When true, payments are only authorized, not captured
   * @default false
   */
  preauth?: boolean

  /**
   * Payment method filter
   * 'ALL' for all available methods, or specific method code
   * @see https://help.comgate.cz/docs/en/api-protocol-en#method-parameter
   * @default 'ALL'
   */
  method?: string

  /**
   * Base URL for return redirects
   * If not set, uses NEXT_PUBLIC_SERVER_URL or falls back to localhost:3000
   */
  serverUrl?: string
}

/**
 * Client-side Comgate adapter configuration
 */
export interface ComgateAdapterClientArgs extends PaymentAdapterClientArgs {
  /**
   * Display label for the payment method
   * @default 'Comgate'
   */
  label?: string
}
