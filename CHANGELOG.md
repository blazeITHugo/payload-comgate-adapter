# Changelog

All notable changes to `payload-comgate-adapter`.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.0] — 2026-08-15

Ports the generic features that had accumulated in the internal monorepo copy of
this adapter, and opens the host-specific seams it grew as **injection points**
rather than hardcoding anyone's business rules. Every hook is optional with a
no-op default, so 0.4.0 behaviour is preserved unless you opt in.

### Added

- **Customer detail for 3DS2 / the Comgate portal.** `initiatePayment` now maps
  the checkout payload onto Comgate's optional detail params — `fullName`,
  `phone`, `billingAddr*`, `delivery`, `homeDelivery*`, `category`, `name` — via
  the new `buildCustomerDetails` (exported). Comgate forwards them into the
  issuer's 3DS2 authentication request, which raises the odds of a
  *frictionless* flow instead of a challenge, and they fill in the payment
  detail support and dispute handling read. The mapping is total: values are
  trimmed, truncated and validated (`country` must be ISO alpha-2, `phone` must
  already be E.164) and anything missing or malformed is omitted, so a bad
  address can never be why a payment fails to initiate.
- **`category` config** (`'PHYSICAL_GOODS_ONLY'` | `'OTHER'`, default
  `'PHYSICAL_GOODS_ONLY'`) — the order-content category in the 3DS2 payload.
- **Return-URL split.** `url_paid` / `url_pending` point at the confirm-order
  return URL; `url_cancelled` points at `/checkout/cancel`, so a cancelled
  payment no longer has to fail a confirm call before the payer sees the cancel
  page. `ComgatePaymentRequest` gained `cancelUrl` and `pendingUrl`.
- **`getAppleDomainAssociation(merchantId, secret)`** — fetches the Apple Pay
  domain-association file for an eshop connection, needed to serve
  `/.well-known/apple-developer-merchantid-domain-association` before Apple will
  verify the domain for an in-page wallet sheet. Comgate rotates the file's
  content, so it must be fetched on demand rather than committed. Accepts both
  response encodings the API uses (JSON and form-urlencoded).
- **Wallet method aliases.** `APPLEPAY` → `APPLEPAY_REDIRECT`, `GOOGLEPAY` →
  `GOOGLEPAY_REDIRECT`. The bare codes are not method codes at all — `create`
  answers `Error [1109] - Invalid payment method` and the payer dead-ends on an
  abandoned cart.
- **Error-1109 retry.** A method the eshop connection has not activated is
  retried once with the configured default method, so the payer still reaches
  the gateway (whose own page offers the wallet when available). Enabled by
  `createPayment` now throwing `PaymentError` with
  `code: 'COMGATE_CREATE_REJECTED'` and `details.comgateCode`.
- **`gatewayTransactionId`** on the `initiatePayment` result — the Comgate
  `transId`, for an in-page Checkout SDK that drives the wallet sheet without a
  redirect.
- **Injection points on `ComgateAdapterArgs`**, all optional:
  - `validateCart(ctx)` — refuse a payment before any write (minimum order
    value, credit blocks).
  - `resolveDiscountCents(ctx)` — server-side authority on the promo discount.
    The client-supplied claim is passed as `claimedDiscountCents`; return what
    the code is actually worth, or `0` to drop an unverifiable claim.
  - `enrichTransactionData(data, ctx)` — final say over the `transactions`
    create payload (tenant relations, consent stamps, checkout notes).
  - `resolveItemPricing(input)` — override per-line pricing at `confirmOrder`
    for carts carrying server-written prices the catalog cannot reproduce
    (bundle apportionment, contract prices). May return `extraFields` to merge
    host-specific columns onto the order item.
  - `enrichOrderData(data, ctx)` — final say over the `orders` create payload
    (tenant pinning, cart-level groups, consents carried off the transaction).
- **Cart currency guard.** When the checkout sends `data.expectedCurrency`, a
  cart whose currency differs from what the storefront displayed is refused with
  `CART_CURRENCY_MISMATCH` instead of being charged in the wrong currency.
  Clients that don't send it are unaffected.
- Release tooling: `prepublishOnly` (build + test), a tag-triggered
  `npm publish --provenance` workflow, and this changelog.

### Changed

- **Peer dependency `payload-payment-shared` is now `^0.2.0`** — the adapter uses
  its `assertExpectedCurrency`, `asTransactionCollection`, `asOrderId`,
  `extractRelationId` and `resolveOrderItemPricing`.
- Order lines are priced by `resolveOrderItemPricing` (was
  `resolveOrderItemPrice`), so a line that sold below its regular price now
  carries `originalPrice` on the order item. Fields your `orders` collection
  does not declare are dropped by Payload as before.
- A non-numeric `transactions.order` relation now throws
  `ORDER_RELATION_INVALID` (via `asOrderId`) instead of being typed as a number
  and silently returned as the order id.

## [0.4.0]

- `payload-payment-shared` runtime, per-currency eshop connections, subscription
  (`initRecurring`) support.

## [0.3.0]

- Real refund implementation via `/v1.0/refund` (was a stub returning fake
  success). 20-test suite for initiate / confirm / refund.

## [0.2.0]

- Pricing breakdown passthrough, billing + shipping address passthrough,
  cents/units fix, form-urlencoded body, Basic Auth header, `returnUrl`,
  `customerEmail` in the confirm response, mock-mode improvements.

## [0.1.1]

Initial release.

[0.5.0]: https://github.com/blazeITHugo/payload-comgate-adapter/releases/tag/v0.5.0
[0.4.0]: https://github.com/blazeITHugo/payload-comgate-adapter/releases/tag/v0.4.0
[0.3.0]: https://github.com/blazeITHugo/payload-comgate-adapter/releases/tag/v0.3.0
[0.2.0]: https://github.com/blazeITHugo/payload-comgate-adapter/releases/tag/v0.2.0
[0.1.1]: https://github.com/blazeITHugo/payload-comgate-adapter/releases/tag/v0.1.1
