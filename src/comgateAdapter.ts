import type { PaymentAdapter } from '@payloadcms/plugin-ecommerce/types'
import type { Field, GroupField, JsonObject } from 'payload'
import type { ComgateAdapterArgs, ComgateCurrency, ComgatePaymentRequest } from './types'
import {
  PaymentError,
  asTransactionDoc,
  createPayment,
  getPaymentStatus,
  isMockMode,
  isMockTransactionId,
  createMockPaymentResponse,
  createMockStatusResponse,
} from './utils'
// Comgate's original `resolveCustomerId` (no email lookup) is now the
// shared secure default — all three payment adapters use the same
// implementation to avoid semantic drift.
import {
  resolveCustomerId,
  withPaymentLock,
  resolveOrderItemPrice,
  calcSubscriptionDiscountCents,
  type PricingContext,
} from 'payload-payment-shared'

/**
 * Narrow type-guard for "this order/cart carries at least one subscription
 * line". The adapter package is slug-agnostic — it has no compile-time
 * knowledge of the host's `subscriptionAssignments[]` array shape — so we
 * accept `unknown` and probe the array length defensively. Used to decide
 * whether the Comgate `create` call needs `initRecurring: 'Y'`.
 */
interface SubscriptionAssignmentLike {
  assignmentKey: string
}
function orderHasSubscriptions(order: unknown): boolean {
  if (!order || typeof order !== 'object') return false
  const subs = (order as { subscriptionAssignments?: unknown }).subscriptionAssignments
  if (!Array.isArray(subs) || subs.length === 0) return false
  // Sanity check: at least one entry looks like a SubscriptionAssignmentLike.
  // We don't iterate fully — we just need a non-empty array; the host
  // collection's own validators police the shape.
  return subs.some(
    (s): s is SubscriptionAssignmentLike =>
      !!s && typeof s === 'object' && typeof (s as { assignmentKey?: unknown }).assignmentKey === 'string',
  )
}

type HeaderReadable = { headers?: { get?: (key: string) => string | null } }

/**
 * Public host of the incoming checkout request, derived from its headers.
 * Prefer `x-forwarded-host`: on Vercel the raw `host` header is the internal
 * Lambda hostname, not the public domain. Mirrors the app's
 * `src/lib/request-host.ts` (inlined to keep the adapter package free of an
 * app-layer import). Returns null when no usable host header is present.
 *
 * SECURITY: these headers are client-influenceable — the caller MUST validate
 * the returned host against a store-domain allowlist before trusting it (see
 * `isReturnHostAllowed`). It is an open-redirect sink otherwise.
 */
function hostFromReqHeaders(req: HeaderReadable): string | null {
  const read = (key: string): string | null => req.headers?.get?.(key) ?? null

  const forwarded = read('x-forwarded-host')
  if (forwarded) return forwarded.split(',')[0]!.trim()

  for (const key of ['origin', 'referer'] as const) {
    const value = read(key)
    if (value) {
      try {
        return new URL(value).host
      } catch {
        // malformed — try the next source
      }
    }
  }

  return read('host')
}

/**
 * Build the `scheme://host` origin for an already-validated host. Scheme prefers
 * `x-forwarded-proto`, else https — except localhost, which is http for dev.
 */
function originForHost(host: string, req: HeaderReadable): string {
  const hostname = host.split(':')[0]
  const proto =
    req.headers?.get?.('x-forwarded-proto') ??
    (hostname === 'localhost' || hostname.endsWith('.localhost') ? 'http' : 'https')
  return `${proto}://${host}`
}

/**
 * Comgate payment adapter for PayloadCMS ecommerce plugin
 *
 * @example
 * ```typescript
 * import { comgateAdapter } from 'payload-comgate-adapter'
 *
 * ecommercePlugin({
 *   payments: {
 *     paymentMethods: [
 *       comgateAdapter({
 *         merchantId: process.env.COMGATE_MERCHANT_ID!,
 *         secret: process.env.COMGATE_SECRET!,
 *         testMode: true,
 *         country: 'SK',
 *         lang: 'sk',
 *       }),
 *     ],
 *   },
 * })
 * ```
 */
export const comgateAdapter = (config: ComgateAdapterArgs): PaymentAdapter => {
  const {
    merchantId,
    secret,
    credentialsByCurrency,
    testMode = false,
    country = 'CZ',
    lang = 'cs',
    preauth = false,
    method = 'ALL',
    label = 'Comgate',
    serverUrl,
    isReturnHostAllowed,
    groupOverrides,
  } = config

  /**
   * Resolve which eshop connection's credentials to use for a given currency.
   * Currencies with a `credentialsByCurrency` entry use that connection; all
   * others fall back to the default `merchantId`/`secret`.
   */
  const resolveCredentials = (currency?: string | null): { merchantId: string; secret: string } => {
    const key = currency?.toUpperCase() as ComgateCurrency | undefined
    const override = key ? credentialsByCurrency?.[key] : undefined
    return override ?? { merchantId, secret }
  }

  const getServerUrl = (): string => {
    return serverUrl || process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000'
  }

  /**
   * Initiate a payment with Comgate
   */
  const initiatePayment: PaymentAdapter['initiatePayment'] = async ({
    data,
    req,
    transactionsSlug,
  }) => {
    const payload = req.payload

    // Validate required data
    const currency = data.currency
    // Allow per-payment country override (e.g. 'CZ' for Czech locale)
    const paymentCountry = (data as Record<string, unknown>).country as string | undefined || country
    const paymentLang = (data as Record<string, unknown>).lang as string | undefined || lang
    const comgateMethod = (data as Record<string, unknown>).comgateMethod as string | undefined
    const cart = data.cart as
      | {
          id: string | number
          subtotal: number
          pricingContext?: PricingContext
          items: unknown[]
        }
      | undefined
    const customerEmail =
      data.customerEmail || (req.user?.collection === 'users' ? req.user.email : undefined)

    if (!currency) {
      throw new PaymentError('Currency is required.')
    }

    if (!customerEmail) {
      throw new PaymentError('Customer email is required.')
    }

    const customerId = await resolveCustomerId(req, customerEmail)

    if (!cart || typeof cart.subtotal !== 'number') {
      throw new PaymentError('Valid cart with subtotal is required.')
    }

    // Resolve the cart's pricing tier so it can be stamped on the transaction
    // (and copied to the order at confirmOrder). Prefer the value the plugin
    // passed on the cart; fall back to a direct read when it's absent.
    //
    // We also need `subscriptionAssignments[]` from the cart row to decide
    // whether to enrol the card for Comgate recurring (`initRecurring: 'Y'`).
    // The plugin-supplied `cart` object only carries `{ id, subtotal, items,
    // pricingContext }` — subscription assignments live on the cart doc
    // itself — so when subscriptions are in play we always need a direct
    // read. To avoid two round-trips, fetch once if EITHER signal is needed.
    let pricingContext: PricingContext = cart.pricingContext ?? 'b2c'
    let hasSubscriptions = false
    // Subscribe & Save discount (cents), recomputed server-side from the cart's
    // `subscriptionAssignments[]` snapshot so the charged amount reflects it.
    let subscriptionDiscountCents = 0
    if (typeof cart.id === 'number') {
      try {
        const cartDoc = await payload.findByID({
          collection: 'carts',
          id: cart.id,
          depth: 0,
          overrideAccess: true,
          req,
        })
        if (cart.pricingContext == null) {
          if ((cartDoc as { pricingContext?: PricingContext })?.pricingContext === 'b2b') {
            pricingContext = 'b2b'
          }
        }
        if (orderHasSubscriptions(cartDoc)) {
          hasSubscriptions = true
        }
        subscriptionDiscountCents = calcSubscriptionDiscountCents(
          (cartDoc as { subscriptionAssignments?: unknown }).subscriptionAssignments,
        )
      } catch {
        // Cart not found — keep the default b2c context and no subscriptions.
      }
    }

    // Calculate total (additionalData can include discount, shipping, etc.)
    // All monetary values from additionalData are in the ORDER'S CURRENCY (not always EUR)
    const additionalData = data as Record<string, unknown>
    const discount = additionalData.discount as
      | { calculatedAmount?: number; [key: string]: unknown }
      | undefined
    const shippingMethod = additionalData.shippingMethod as
      | { cost?: number; [key: string]: unknown }
      | undefined
    const pricingData = additionalData.pricing as
      | {
          subtotal?: number
          discountAmount?: number
          shippingCost?: number
          grandTotal?: number
          freeShipping?: boolean
        }
      | undefined

    // Use explicit pricing data if provided (preferred), otherwise calculate from cart
    const subtotalCents = cart.subtotal // CENTS from ecommerce plugin
    const promoDiscountCents = discount?.calculatedAmount || 0 // CENTS (promo code)
    // Total monetary discount = promo + Subscribe & Save. The subscription part
    // is recomputed server-side from the cart snapshot (never trusted from the
    // client) so a subscribed line is actually charged its discounted price.
    const discountCents = promoDiscountCents + subscriptionDiscountCents
    const shippingCostValue = pricingData?.shippingCost ?? shippingMethod?.cost ?? 0
    const shippingCents = Math.round(shippingCostValue * 100)

    const cartTotalCents = Math.max(0, subtotalCents - discountCents) + shippingCents
    const cartTotal = cartTotalCents / 100

    // Pricing breakdown in order currency
    const subtotalInCurrency = subtotalCents / 100
    const discountInCurrency = discountCents / 100

    // Server-side recalculation — never trust client-supplied grandTotal
    const calculatedGrandTotal = cartTotal
    if (pricingData?.grandTotal != null && Math.abs(pricingData.grandTotal - calculatedGrandTotal) > 1) {
      payload.logger.warn({
        msg: '[Comgate] Client-supplied grandTotal differs from server calculation',
        clientGrandTotal: pricingData.grandTotal,
        calculatedGrandTotal,
        difference: Math.abs(pricingData.grandTotal - calculatedGrandTotal),
      })
    }
    const grandTotalInCurrency = calculatedGrandTotal

    let transaction: { id: string | number } | undefined

    try {
      // Create transaction record with complete pricing breakdown
      // Pass req so assignTenantFromCurrency hook can read x-tenant-id header
      transaction = await payload.create({
        collection: transactionsSlug as 'transactions',
        req,
        data: {
          paymentMethod: 'comgate' as const,
          status: 'pending' as const,
          amount: grandTotalInCurrency,
          currency: currency.toUpperCase() as ComgateCurrency,
          cart: typeof cart.id === 'number' ? cart.id : undefined,
          ...(customerId != null ? { customer: customerId } : {}),
          customerEmail,
          pricingContext,
          // Pricing breakdown
          subtotal: subtotalInCurrency,
          subtotalBeforeDiscount: subtotalInCurrency,
          discountAmount: discountInCurrency,
          shippingCost: shippingCostValue,
          grandTotal: grandTotalInCurrency,
          freeShipping: pricingData?.freeShipping ?? shippingCostValue === 0,
          // Discount details
          ...(additionalData.discount ? { discount: additionalData.discount } : {}),
          // Shipping method details
          ...(additionalData.shippingMethod
            ? { shippingMethod: additionalData.shippingMethod }
            : {}),
          // Addresses
          ...(additionalData.shippingAddress
            ? { shippingAddress: additionalData.shippingAddress }
            : {}),
          ...(additionalData.billingAddress
            ? { billingAddress: additionalData.billingAddress }
            : {}),
          // OSS data (passed through to order on confirm)
          ...(additionalData.ossData ? { ossData: additionalData.ossData } : {}),
        },
      })

      const refId = String(transaction.id)
      const paymentLabel = `Obj-${refId.substring(0, 12)}`
      // Return the customer to the SAME store domain they checked out on
      // (host-derived), not the single static NEXT_PUBLIC_SERVER_URL — one
      // deployment serves voxberg.rs/.cz/.sk, and the cart cookie is
      // domain-scoped. SECURITY: the host comes from client-influenceable
      // headers, so it's only used when `isReturnHostAllowed` confirms it's one
      // of our store domains; otherwise (unknown host, forged header, no
      // validator, or no host header at all) we fall back to the configured
      // server URL. This closes the open-redirect / host-header-injection sink.
      const derivedHost = hostFromReqHeaders(req)
      const returnBase =
        derivedHost && isReturnHostAllowed?.(derivedHost)
          ? originForHost(derivedHost, req)
          : getServerUrl()
      const returnUrl = `${returnBase}/checkout/confirm-order`
      const price = cartTotalCents // Already in cents

      let transId: string
      let redirect: string

      // Pick the eshop connection for this payment's currency, then decide
      // mock vs real based on that connection's credentials.
      const { merchantId: payMerchantId, secret: paySecret } = resolveCredentials(currency)
      const mockMode = isMockMode(payMerchantId, paySecret)

      if (mockMode) {
        payload.logger.info('🧪 MOCK MODE: Simulating Comgate payment creation')
        const mockResponse = createMockPaymentResponse(refId, customerEmail, getServerUrl())
        transId = mockResponse.transId!
        redirect = mockResponse.redirect!
        payload.logger.info({ msg: '🧪 MOCK: Payment created', transId, redirect })
      } else {
        const request: ComgatePaymentRequest = {
          test: testMode,
          country: paymentCountry,
          price,
          curr: currency.toUpperCase(),
          label: paymentLabel,
          refId,
          method: comgateMethod || method,
          email: customerEmail,
          lang: paymentLang,
          preauth,
          returnUrl,
          // First-payment of a subscription order: ask Comgate to enrol the
          // card so the cron-driven recurring charges can re-bill via the
          // returned `payerAcc` token. Plain one-off orders skip this flag.
          ...(hasSubscriptions ? { initRecurring: 'Y' as const } : {}),
        }

        const response = await createPayment(payMerchantId, paySecret, request)

        if (!response.transId || !response.redirect) {
          throw new PaymentError('Comgate returned success but missing transId or redirect URL')
        }

        transId = response.transId
        redirect = response.redirect
      }

      // Update transaction with Comgate transId — thread `req` for
      // Payload transaction atomicity.
      await payload.update({
        id: transaction.id,
        collection: transactionsSlug as 'transactions',
        req,
        data: {
          comgate: { transId },
        },
      })

      return {
        message: 'Payment initiated successfully',
        redirect,
        transactionID: transaction.id,
      }
    } catch (error) {
      payload.logger.error(error, 'Error initiating payment with Comgate')

      // Mark transaction as failed — thread `req` + `overrideAccess` so
      // a retry from a different tenant session can still clean up a
      // partially-initialised pending transaction.
      if (transaction?.id) {
        await payload
          .update({
            collection: transactionsSlug as 'transactions',
            id: transaction.id,
            req,
            overrideAccess: true,
            data: { status: 'failed' as const },
          })
          .catch((e) => payload.logger.error(e, 'Failed to update transaction status'))
      }

      if (error instanceof PaymentError) {
        throw error
      }

      throw new PaymentError(
        error instanceof Error ? error.message : 'Unknown error initiating payment',
      )
    }
  }

  /**
   * Confirm order after successful Comgate payment
   */
  const confirmOrder: PaymentAdapter['confirmOrder'] = async ({
    data,
    ordersSlug = 'orders',
    req,
    transactionsSlug = 'transactions',
    cartsSlug = 'carts',
  }) => {
    const payload = req.payload
    const transId = data.transId as string

    if (!transId) {
      throw new PaymentError('Comgate transaction ID is required')
    }

    try {
      interface ComgateTransaction {
        id: string | number
        amount: number
        currency?: string
        customerEmail?: string
        pricingContext?: PricingContext
        cart?: {
          id: string | number
          items: Array<{ product: unknown; variant?: unknown; quantity: number }>
        }
        comgate?: Record<string, unknown>
        [key: string]: unknown
      }

      // First read (outside the lock) — if the order is already linked,
      // short-circuit without taking the lock at all. Saves one round-trip
      // for the common "user clicked back into success_url after webhook"
      // case.
      // overrideAccess: confirmOrder runs from webhook/callback without user session
      const initialResults = await payload.find({
        collection: transactionsSlug as 'transactions',
        overrideAccess: true,
        where: {
          'comgate.transId': { equals: transId },
        },
        depth: 0,
        limit: 1,
      })

      if (initialResults.docs.length === 0) {
        throw new PaymentError('Transaction not found')
      }

      const initialTx = asTransactionDoc<ComgateTransaction>(initialResults.docs[0])
      if (initialTx.order) {
        const existingOrderId =
          typeof initialTx.order === 'object' && initialTx.order !== null
            ? (initialTx.order as { id: number }).id
            : (initialTx.order as number)
        return {
          message: 'Order already confirmed',
          orderID: existingOrderId,
          transactionID: initialTx.id as number,
          customerEmail: initialTx.customerEmail,
        }
      }

      // Resolve tenant scope for the lock key from the transaction we just
      // fetched (transaction always has tenant by the time confirmOrder
      // runs — set during initiatePayment).
      const initialTenantRaw = (initialTx as { tenant?: unknown }).tenant
      const initialTenantId =
        typeof initialTenantRaw === 'object' && initialTenantRaw !== null
          ? (initialTenantRaw as { id: number | string }).id
          : (initialTenantRaw as number | string | undefined)
      const lockKey = `${transId}:comgate:${initialTenantId ?? 'no-tenant'}`

      return await withPaymentLock(payload, req, lockKey, async (req) => {
        // Re-fetch INSIDE the lock with full depth — the initial read
        // above is a stale snapshot from before lock acquisition. Another
        // concurrent webhook may have created the order in between.
        const transactionsResults = await payload.find({
          collection: transactionsSlug as 'transactions',
          overrideAccess: true,
          req,
          where: {
            'comgate.transId': { equals: transId },
          },
          depth: 2, // Populate cart and its items/products
          limit: 1,
        })

        if (transactionsResults.docs.length === 0) {
          throw new PaymentError('Transaction not found')
        }

        const transaction = asTransactionDoc<ComgateTransaction>(transactionsResults.docs[0])

        // Serialised idempotent short-circuit — if the other lock-waiter
        // already wrote the order, return it now.
        if (transaction.order) {
          const existingOrderId =
            typeof transaction.order === 'object' && transaction.order !== null
              ? (transaction.order as { id: number }).id
              : (transaction.order as number)
          return {
            message: 'Order already confirmed',
            orderID: existingOrderId,
            transactionID: transaction.id as number,
            customerEmail: transaction.customerEmail,
          }
        }

        // Verify payment status
        let paymentStatus: string
        let fee: string | undefined
        let payerName: string | undefined
        let payerAcc: string | undefined

        // Resolve the eshop connection for this transaction's currency, then
        // decide mock vs real from THAT connection's credentials — never from
        // the caller-controlled transId prefix alone. A forged `MOCK-` transId
        // arriving on the success_url callback must not be able to skip the
        // real getPaymentStatus PAID/amount/currency verification when live
        // credentials are configured (mirrors CorvusPay's `mockMode &&
        // isMockSignature(...)` gate and initiatePayment's own isMockMode gate).
        const { merchantId: statMerchantId, secret: statSecret } = resolveCredentials(
          transaction.currency,
        )
        const mockMode = isMockMode(statMerchantId, statSecret)

        if (mockMode && isMockTransactionId(transId)) {
          payload.logger.info('🧪 MOCK MODE: Simulating successful payment verification')
          const mockStatus = createMockStatusResponse(
            transId,
            transaction.amount,
            transaction.currency,
          )
          paymentStatus = mockStatus.status!
          fee = mockStatus.fee
          payerName = mockStatus.payerName
          payerAcc = mockStatus.payerAcc
        } else {
          const statusResponse = await getPaymentStatus(statMerchantId, statSecret, transId)

          if (statusResponse.status !== 'PAID') {
            throw new PaymentError(`Payment not completed. Status: ${statusResponse.status}`)
          }

          // Verify amount and currency match what we expected
          const confirmedPrice = parseInt(statusResponse.price ?? '0', 10)
          const expectedPrice = Math.round(transaction.amount * 100)
          if (confirmedPrice !== expectedPrice) {
            throw new PaymentError(
              `Payment amount mismatch: expected ${expectedPrice} cents, got ${confirmedPrice} cents`,
            )
          }
          if (
            statusResponse.curr &&
            statusResponse.curr.toUpperCase() !== (transaction.currency || '').toUpperCase()
          ) {
            throw new PaymentError(
              `Currency mismatch: expected ${transaction.currency}, got ${statusResponse.curr}`,
            )
          }

          paymentStatus = statusResponse.status
          fee = statusResponse.fee
          payerName = statusResponse.payerName
          payerAcc = statusResponse.payerAcc
        }

        // Extract order items from cart — unit price re-derived via the shared
        // resolver so b2c (retail, honours salePrice) and b2b (wholesale tier)
        // stay consistent across every adapter.
        const orderPricingContext: PricingContext = transaction.pricingContext || 'b2c'

        const orderItems = (transaction.cart?.items?.map((item) => {
          const product =
            typeof item.product === 'object' && item.product !== null
              ? (item.product as Record<string, unknown>)
              : null
          const variant =
            item.variant && typeof item.variant === 'object'
              ? (item.variant as Record<string, unknown>)
              : null
          const source = variant || product
          const price = resolveOrderItemPrice(
            source,
            transaction.currency || 'EUR',
            orderPricingContext,
          )

          return {
            product: product ? (product.id as number) : item.product,
            variant: variant ? (variant.id as number) : item.variant,
            quantity: item.quantity,
            priceAtPurchase: price / 100, // cents → decimal
          }
        }) || []) as Array<{ product?: number | null; variant?: number | null; quantity: number; priceAtPurchase: number }>

        // Create order — always use the customer stored on the transaction
        // during initiatePayment. Do NOT fall back to `req.user?.id` — see
        // CorvusPay adapter for the shared-computer / stale-cookie
        // scenario that motivated this.
        const storedCustomerId =
          typeof transaction.customer === 'object' && transaction.customer !== null
            ? (transaction.customer as { id: number }).id
            : typeof transaction.customer === 'number'
              ? transaction.customer
              : undefined
        const transactionData = transaction as Record<string, unknown>

        // Extract OSS data if present (from additionalData passed during initiatePayment)
        const ossData = transactionData.ossData as
          | { deliveryCountry?: string; vatRate?: number; vatAmount?: number; isOss?: boolean }
          | undefined

        const orderData = {
          customer: storedCustomerId || undefined,
          customerEmail: transaction.customerEmail,
          items: orderItems,
          amount: transaction.amount,
          currency: transaction.currency,
          status: 'processing',
          pricingContext: orderPricingContext,
          // Pricing breakdown
          subtotal: transactionData.subtotal,
          subtotalBeforeDiscount: transactionData.subtotalBeforeDiscount,
          discountAmount: transactionData.discountAmount,
          shippingCost: transactionData.shippingCost,
          grandTotal: transactionData.grandTotal,
          freeShipping: transactionData.freeShipping,
          // Discount details
          ...(transactionData.discount ? { discount: transactionData.discount } : {}),
          // Shipping method
          ...(transactionData.shippingMethod
            ? { shippingMethod: transactionData.shippingMethod }
            : {}),
          // Addresses
          ...(transactionData.shippingAddress
            ? { shippingAddress: transactionData.shippingAddress }
            : {}),
          ...(transactionData.billingAddress
            ? { billingAddress: transactionData.billingAddress }
            : {}),
          // OSS VAT data
          ...(ossData?.deliveryCountry
            ? {
                ossDeliveryCountry: ossData.deliveryCountry,
                ossVatRate: ossData.vatRate,
                ossVatAmount: ossData.vatAmount,
                isOssSale: ossData.isOss ?? false,
              }
            : {}),
        }

        const order = await payload.create({
          collection: ordersSlug as 'orders',
          overrideAccess: true,
          req,
          // The adapter is slug-agnostic — it has no access to the host's
          // generated Payload types, so the orders collection shape is
          // unknown to TS at this site. `JsonObject` is Payload's own
          // permissive create-data shape (matches `RequiredDataFromCollection`
          // when collection types aren't registered), and lets us drop the
          // `as any` escape hatch without losing call-site type checking
          // for everything else inside `payload.create`.
          data: orderData as JsonObject,
        })

        // Mark cart as purchased AND detach it from the customer in the SAME
        // update — thread `req` for transaction atomicity. Detaching (customer:
        // null) is what makes repeat purchases work: the `users.cart` join only
        // returns active carts, so the ecommerce provider's mount effect stops
        // re-adopting this dead cart on the next page load. One update, no extra
        // hook, transaction-safe.
        if (transaction.cart?.id) {
          await payload.update({
            id: transaction.cart.id,
            collection: cartsSlug as 'carts',
            overrideAccess: true,
            req,
            data: { purchasedAt: new Date().toISOString(), customer: null },
          })
        }

        // Update transaction — pin `tenant` so the multi-tenant plugin's
        // injected `filterOptions` on the `order` relationship scopes by the
        // transaction's own tenant, not the `payload-tenant` admin cookie /
        // `req.user` carried over from the browser. `overrideAccess: true`
        // skips collection access but does NOT propagate into a relationship
        // field's `filterOptions` resolver — see CorvusPay adapter for the
        // full trace through Payload core + plugin-multi-tenant.
        //
        // Note: the previous `comgate.confirming = true` flag-then-recheck
        // pattern is removed here — `withPaymentLock` provides true
        // serialisation, so the flag is no longer load-bearing.
        const transactionTenantRaw = (transaction as { tenant?: unknown }).tenant
        const transactionTenantId =
          typeof transactionTenantRaw === 'object' && transactionTenantRaw !== null
            ? (transactionTenantRaw as { id: number | string }).id
            : (transactionTenantRaw as number | string | undefined)

        // Idempotency: never clobber an already-stored `payerAcc`. The cron
        // billing job at /api/cron/billing keys recurring charges off this
        // value, so overwriting it with an empty/undefined response (e.g.
        // when Comgate's status read races against the webhook) would break
        // every future subscription charge.
        const existingPayerAcc =
          typeof transaction.comgate?.payerAcc === 'string' && transaction.comgate.payerAcc.length > 0
            ? transaction.comgate.payerAcc
            : undefined
        const resolvedPayerAcc = existingPayerAcc ?? payerAcc

        await payload.update({
          id: transaction.id,
          collection: transactionsSlug as 'transactions',
          overrideAccess: true,
          req,
          data: {
            ...(transactionTenantId !== undefined ? { tenant: transactionTenantId } : {}),
            order: order.id,
            status: 'succeeded' as const,
            comgate: {
              ...transaction.comgate,
              status: paymentStatus,
              fee,
              payerName,
              payerAcc: resolvedPayerAcc,
            },
          },
        })

        return {
          message: 'Order confirmed successfully',
          orderID: order.id as number,
          transactionID: transaction.id as number,
          customerEmail: transaction.customerEmail,
        }
      })
    } catch (error) {
      payload.logger.error(error, 'Error confirming order with Comgate')

      if (error instanceof PaymentError) {
        throw error
      }

      throw new PaymentError(
        error instanceof Error ? error.message : 'Unknown error confirming order',
      )
    }
  }

  // Define Comgate group field for transaction data
  const baseFields: Field[] = [
    {
      name: 'transId',
      type: 'text',
      label: 'Comgate Transaction ID',
      admin: { readOnly: true },
    },
    {
      name: 'status',
      type: 'text',
      label: 'Payment Status',
      admin: { readOnly: true },
    },
    {
      name: 'fee',
      type: 'text',
      label: 'Transaction Fee',
      admin: { readOnly: true },
    },
    {
      name: 'payerName',
      type: 'text',
      label: 'Payer Name',
      admin: { readOnly: true },
    },
    {
      name: 'payerAcc',
      type: 'text',
      label: 'Payer Account',
      admin: { readOnly: true },
    },
  ]

  let finalFields: Field[] = baseFields

  if (groupOverrides?.fields) {
    if (typeof groupOverrides.fields === 'function') {
      finalFields = groupOverrides.fields({ defaultFields: baseFields })
    } else {
      finalFields = groupOverrides.fields as Field[]
    }
  }

  const groupField: GroupField = {
    name: 'comgate',
    type: 'group',
    admin: {
      condition: (data) => data?.paymentMethod === 'comgate',
      ...(groupOverrides?.admin || {}),
    },
    fields: finalFields,
  }

  return {
    name: 'comgate',
    label,
    initiatePayment,
    confirmOrder,
    group: groupField,
  }
}
