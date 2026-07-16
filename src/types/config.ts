import type {
  PaymentAdapterArgs,
  PaymentAdapterClientArgs,
} from '@payloadcms/plugin-ecommerce/types'
import type { Currency } from 'payload-payment-shared'

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
 * Supported Comgate currencies (ISO 4217), narrowed from the shared
 * `Currency` superset in `payload-payment-shared`. Non-CZK currencies may
 * require activation via Comgate support (bank statement proving account
 * can accept the currency).
 *
 * Using `Extract<Currency, ...>` keeps every adapter's narrow union
 * structurally compatible with the shared `Currency` type used by carts /
 * orders / invoices — adding a new currency in one place flows here.
 *
 * @see https://help.comgate.cz/docs/en/currencies-and-languages
 */
export type ComgateCurrency = Extract<
  Currency,
  'CZK' | 'EUR' | 'PLN' | 'HUF' | 'USD' | 'GBP' | 'RON' | 'NOK' | 'SEK'
>

/**
 * A single Comgate eshop-connection credential pair ("prepojenie obchodu").
 */
export interface ComgateConnectionCredentials {
  merchantId: string
  secret: string
}

/**
 * Server-side Comgate adapter configuration
 */
export interface ComgateAdapterArgs extends PaymentAdapterArgs {
  /**
   * Comgate merchant ID (6-digit number) of the default eshop connection.
   * Get this from https://portal.comgate.cz
   */
  merchantId: string

  /**
   * Comgate API secret of the default eshop connection.
   * Get this from https://portal.comgate.cz
   */
  secret: string

  /**
   * Per-currency credential overrides. When a payment's currency has an entry
   * here, the adapter routes it to that eshop connection's merchantId/secret
   * instead of the default pair above — letting a single adapter instance
   * serve separate Comgate connections per currency (e.g. EUR vs CZK).
   *
   * Currencies without an entry fall back to the default `merchantId`/`secret`.
   */
  credentialsByCurrency?: Partial<Record<ComgateCurrency, ComgateConnectionCredentials>>

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

  /**
   * Allowlist predicate for the request-derived return host.
   *
   * The customer is redirected back to their checkout domain after paying, and
   * that domain is derived from the incoming request headers
   * (`x-forwarded-host` etc.) so a single deployment can serve multiple store
   * domains. Those headers are client-influenceable, so the derived host is an
   * OPEN-REDIRECT sink: it MUST be validated against the known store domains
   * before use. Return `true` only for hosts you own. When this predicate is
   * omitted (or the host fails it), the adapter ignores the request headers and
   * falls back to `serverUrl` / `NEXT_PUBLIC_SERVER_URL`.
   *
   * @example (host) => matchTenantByDomain(host) !== null
   */
  isReturnHostAllowed?: (host: string) => boolean
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
