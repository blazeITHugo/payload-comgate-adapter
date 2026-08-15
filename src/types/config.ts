import type {
  PaymentAdapterArgs,
  PaymentAdapterClientArgs,
} from '@payloadcms/plugin-ecommerce/types'
import type { PayloadRequest } from 'payload'
import type { Currency, PricingContext, ResolvedItemPricing } from 'payload-payment-shared'
import type { ComgateCategory } from './api'

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
 * The plugin-supplied cart, as `initiatePayment` receives it. Only `id`,
 * `subtotal` and `items` are guaranteed; the index signature carries whatever
 * else the host's ecommerce plugin put there (e.g. a tenant relation).
 */
export interface ComgateCartLike {
  id: string | number
  /** Cart subtotal in MINOR units (cents / haler / para). */
  subtotal: number
  items: unknown[]
  pricingContext?: PricingContext
  [key: string]: unknown
}

/**
 * What the `initiatePayment` injection points get to look at. Everything here
 * is already resolved and validated by the adapter.
 */
export interface ComgateCartContext {
  req: PayloadRequest
  /** The plugin's payment `data` — addresses, discount claim, shipping method, … */
  data: Record<string, unknown>
  cart: ComgateCartLike
  /** Resolved customer, or `null`/`undefined` for a guest checkout. */
  customerId: number | string | null | undefined
  /** Upper-cased order currency. */
  currency: string
  /** Cart subtotal in MINOR units. */
  subtotalCents: number
  pricingContext: PricingContext
}

/**
 * What the `confirmOrder` injection points get to look at.
 */
export interface ComgateOrderContext {
  req: PayloadRequest
  /** The paid transaction, read at depth 2 so cart items carry their products. */
  transaction: Record<string, unknown>
  /** Order currency (the transaction's, falling back to `'EUR'`). */
  currency: string
  pricingContext: PricingContext
}

/**
 * Unit pricing for one order line, in MINOR units. Extends the shared
 * `ResolvedItemPricing` with an escape hatch for host-specific line fields.
 */
export interface ComgateItemPricing extends ResolvedItemPricing {
  /**
   * Extra fields merged onto the order item alongside `priceAtPurchase` —
   * e.g. a bundle key that ties the line back to a multi-buy assignment.
   */
  extraFields?: Record<string, unknown>
}

/**
 * Price one order line at `confirmOrder`. Receives the raw cart line, so a host
 * whose cart carries server-written prices (bundle apportionment, contract
 * prices) can trust `item.priceAtPurchase` instead of re-deriving from the
 * catalog. `transaction` is passed too, for a resolver that needs cart-level
 * context such as a cross-border delivery destination.
 */
export type ComgateItemPricingResolver = (input: {
  item: Record<string, unknown>
  /** The variant doc when populated, else the product doc, else null. */
  source: Record<string, unknown> | null
  currency: string
  pricingContext: PricingContext
  transaction: Record<string, unknown>
}) => ComgateItemPricing

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
   * Order-content category sent with every payment as part of the 3DS2 payload.
   * Use `'OTHER'` for a catalogue that is not purely physical goods.
   * @default 'PHYSICAL_GOODS_ONLY'
   */
  category?: ComgateCategory

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

  // --- Injection points ------------------------------------------------------
  //
  // The adapter is deliberately generic: it knows nothing about tenants, promo
  // codes, bundles or consent fields. Everything below is an optional hook with
  // a no-op default, so a host can plug its own rules into the two places that
  // matter (before the charge, and when the order is written) without forking
  // the adapter. Leave them unset and the adapter behaves exactly as before.

  /**
   * Last gate before the transaction row and the Comgate `create` call. Throw
   * (ideally a `PaymentError`) to refuse the payment.
   *
   * Runs after the adapter's own currency / email / cart checks, so
   * `ctx.customerId`, `ctx.subtotalCents` and `ctx.pricingContext` are already
   * resolved. Use it for host rules such as a B2B minimum order value or a
   * per-customer credit block.
   */
  validateCart?: (ctx: ComgateCartContext) => void | Promise<void>

  /**
   * Server-side authority on the promo discount, in MINOR units.
   *
   * The claim in `data.discount.calculatedAmount` is client-supplied, and by
   * default it is taken at face value (`claimedDiscountCents`). A host that
   * stores promo codes should re-read the code here and return what it is
   * actually worth — returning `0` silently drops an unverifiable claim.
   *
   * The Subscribe & Save discount is computed by the adapter from the cart
   * snapshot and added on top of whatever this returns.
   */
  resolveDiscountCents?: (
    ctx: ComgateCartContext & {
      /** `data.discount.calculatedAmount`, or 0 when absent. Never trust it as-is. */
      claimedDiscountCents: number
    },
  ) => number | Promise<number>

  /**
   * Final say over the `transactions` create payload. Return the data to write —
   * conventionally `{ ...data, ...extra }`.
   *
   * Use it to carry host-specific fields from the checkout onto the transaction
   * (customer note, consent stamps, a tenant relation) so `confirmOrder` can
   * copy them onto the order later.
   */
  enrichTransactionData?: (
    data: Record<string, unknown>,
    ctx: ComgateCartContext,
  ) => Record<string, unknown> | Promise<Record<string, unknown>>

  /**
   * Override how each order line is priced at `confirmOrder`.
   *
   * Defaults to the shared catalog resolver (`resolveOrderItemPricing`), which
   * re-derives the unit price from the variant/product doc so b2c and b2b stay
   * consistent across gateways. Supply your own when the cart holds prices the
   * catalog cannot reproduce.
   */
  resolveItemPricing?: ComgateItemPricingResolver

  /**
   * Final say over the `orders` create payload. Return the data to write —
   * conventionally `{ ...data, ...extra }`.
   *
   * This is where a multi-tenant host pins the tenant, where cart-level groups
   * (bundle assignments, gift selections) get carried onto the order, and where
   * consents stamped on the transaction are copied across.
   */
  enrichOrderData?: (
    data: Record<string, unknown>,
    ctx: ComgateOrderContext,
  ) => Record<string, unknown> | Promise<Record<string, unknown>>
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
