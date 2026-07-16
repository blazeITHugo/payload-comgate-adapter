# payload-comgate-adapter

[![npm version](https://img.shields.io/npm/v/payload-comgate-adapter.svg)](https://www.npmjs.com/package/payload-comgate-adapter)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Comgate payment gateway adapter for the [PayloadCMS](https://payloadcms.com/) ecommerce plugin.

[Comgate](https://www.comgate.cz/) is a Czech payment gateway covering credit cards, bank transfers, Apple Pay, Google Pay and most CEE currencies. This adapter wires the gateway into `@payloadcms/plugin-ecommerce`, persists transactions, enforces server-side pricing, supports refunds via the Management API and ships a built-in mock mode for local dev.

## Current version

`0.4.0` (per `package.json`).

## Installation

```bash
pnpm add payload-comgate-adapter
```

## Peer dependencies

```jsonc
{
  "@payloadcms/plugin-ecommerce": "^3.81.0",
  "payload": "^3.81.0",
  "payload-payment-shared": "^0.1.0"
}
```

`payload-payment-shared` (commit `0cd6307e`) is a hard peer — see [Shared payment runtime](#shared-payment-runtime).

## Shared payment runtime

This adapter is one of four payment adapters (Comgate, CorvusPay, COD, MiniMax) built on `payload-payment-shared`. The shared package centralises the symbols that used to drift between adapters:

| Symbol                        | Why it has to be shared                                                                                                |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `PaymentError`                | Single class, single `instanceof` check across adapters. Refactor done in commit `63b8d0ba` (P0).                      |
| `resolvePaymentMode` / `isMockSignatureValue` | Standardised mock detection — replaces three forks of `MOCK_*` literals.                                |
| `resolveCustomerId`           | Default-secure (no email lookup for guests). Comgate was always the secure variant; the others now match it.           |
| `createCache`                 | Shared in-memory TTL cache primitive (used by adapters that cache FK lookups; not used by Comgate today).              |
| `consoleLogger` / `noopLogger` | Pino-compatible logger shape. Comgate routes warnings through `req.payload.logger`.                                   |

## Quick start

### Server

```typescript
// payload.config.ts
import { buildConfig } from 'payload'
import { ecommercePlugin } from '@payloadcms/plugin-ecommerce'
import { comgateAdapter } from 'payload-comgate-adapter'

export default buildConfig({
  plugins: [
    ecommercePlugin({
      payments: {
        paymentMethods: [
          comgateAdapter({
            merchantId: process.env.COMGATE_MERCHANT_ID!,
            secret: process.env.COMGATE_SECRET!,
            testMode: process.env.NODE_ENV !== 'production',
            country: 'CZ',
            lang: 'cs',
          }),
        ],
      },
    }),
  ],
})
```

### Client

```typescript
// providers.tsx
import { EcommerceProvider } from '@payloadcms/plugin-ecommerce/client/react'
import { comgateAdapterClient } from 'payload-comgate-adapter/client'

export function Providers({ children }) {
  return (
    <EcommerceProvider
      paymentMethods={[
        comgateAdapterClient({ label: 'Platba kartou (Comgate)' }),
      ]}
    >
      {children}
    </EcommerceProvider>
  )
}
```

### Environment variables

```env
COMGATE_MERCHANT_ID=your-6-digit-merchant-id
COMGATE_SECRET=your-comgate-api-secret
```

## Configuration

### `comgateAdapter(config)`

| Option       | Type              | Default      | Description                                                                                                                                                            |
| ------------ | ----------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `merchantId` | `string`          | **required** | Comgate merchant ID (6-digit number from the Comgate portal).                                                                                                          |
| `secret`     | `string`          | **required** | Comgate API secret. Sent via Basic Auth on every API call (no body-secret duplication — see refund note).                                                              |
| `testMode`   | `boolean`         | `false`      | Forwarded to Comgate's `test=true` flag — enables sandbox processing.                                                                                                  |
| `country`    | `string`          | `'CZ'`       | ISO 3166-1 alpha-2 default country. Can be overridden per payment via `data.country`.                                                                                  |
| `lang`       | `ComgateLanguage` | `'cs'`       | Default checkout language. Can be overridden per payment via `data.lang`. See [Supported languages](#supported-languages).                                             |
| `preauth`    | `boolean`         | `false`      | If true, payments are authorised but not captured.                                                                                                                     |
| `method`     | `string`          | `'ALL'`      | Payment method filter. Per-payment override via `data.comgateMethod`.                                                                                                  |
| `label`      | `string`          | `'Comgate'`  | Admin label for the payment method.                                                                                                                                    |
| `serverUrl`  | `string`          | env / `localhost:3000` | **Fallback origin** for the `/checkout/confirm-order` return URL — used when the request host is missing or fails `isReturnHostAllowed`. Falls back to `process.env.NEXT_PUBLIC_SERVER_URL` then `localhost:3000`. The live return URL prefers the validated request host. |
| `isReturnHostAllowed` | `(host: string) => boolean` | — | Validates the request host before it is trusted as the return-URL origin (open-redirect guard). **Multi-domain deployments MUST supply it** — without it every request falls back to `serverUrl`, so a per-tenant return host is never honoured. voxberg wires `(host) => matchTenantByDomain(host) !== null`. |
| `groupOverrides` | `{ fields?, admin? }` | —     | Override the `comgate` group on the `transactions` collection.                                                                                                         |

### `comgateAdapterClient(config)`

| Option  | Type     | Default     | Description                              |
| ------- | -------- | ----------- | ---------------------------------------- |
| `label` | `string` | `'Comgate'` | Display label inside `EcommerceProvider`. |

### Supported languages

`ComgateLanguage` accepts: `cs`, `sk`, `en`, `pl`, `hu`, `ro`, `de`, `fr`, `es`, `it`, `hr`, `sl`, `no`, `sv`. See [Comgate currencies and languages](https://help.comgate.cz/docs/en/currencies-and-languages).

### Supported currencies (multi-currency)

`ComgateCurrency` accepts: `CZK`, `EUR`, `PLN`, `HUF`, `USD`, `GBP`, `RON`, `NOK`, `SEK`. The order's `currency` is forwarded to Comgate as-is — no client-side restriction.

> Comgate enables only `CZK` by default on every merchant account. To accept any other currency you have to email Comgate support a bank statement proving your account can receive that currency.

**CZK multi-currency for the CZ locale** is live since commit `c0f5596b`. The vendored adapter's language and currency types were widened in commit `04cc11a1` so the CZ store can charge in `CZK` while still using the same merchant account that historically only ran `EUR`. Consumers should still narrow the allowed set in their own `transactions` collection schema (voxberg restricts to `'EUR' | 'CZK'`).

## Runtime behaviour

### `initiatePayment` (success path)

1. Validates `currency`, `customerEmail` and `cart.subtotal` (cents). Throws `PaymentError` otherwise.
2. Resolves customer via `resolveCustomerId(req, email)` — authenticated user or `null` for guest.
3. Recomputes the total server-side: `max(0, subtotal − discount) + shipping`. If the client-supplied `pricing.grandTotal` deviates by more than 1 unit, a structured `payload.logger.warn` is emitted; the **server** total wins.
4. Creates the `transactions` row with `status: 'pending'`, `req` threaded so `assignTenantFromCurrency` can read `x-tenant-id` (commit `40502ef1`). Stores subtotal / discount / shipping / grand total / freeShipping plus addresses, OSS data, etc.
5. Mock mode → fabricates `transId` / `redirect`, never hits the API.
6. Live mode → `POST /create` with form-urlencoded body and Basic Auth, parses the response, persists `comgate.transId` and returns the gateway redirect.
7. On failure: marks the transaction `failed` with `overrideAccess: true` (so a different tenant session can clean up later), then re-throws as `PaymentError`.

### `confirmOrder` (success path)

1. Looks up the transaction by `comgate.transId` (depth 2, populates cart items).
2. **Idempotency** — if `transaction.order` is already linked, returns it.
3. **Concurrency guard** — atomically sets `comgate.confirming = true` and re-checks `.order`. The webhook + the customer's redirect can both land here within milliseconds; this prevents double order creation.
4. Mock mode → synthesises a `PAID` status with mock fee/payer details.
5. Live mode → calls `getPaymentStatus(merchantId, secret, transId)`. Refuses anything other than `PAID`. Verifies amount (cents) and currency match the persisted transaction; either mismatch throws `PaymentError`.
6. Builds order items with currency-specific prices (`priceInEUR`, `salePriceIn{currency}` etc.), creates the order with `overrideAccess: true` (webhooks have no user/tenant session), passes through OSS VAT data when present, marks the cart `purchasedAt`, and updates the transaction with `status: 'succeeded'` plus `comgate.{status, fee, payerName, payerAcc, confirming: false}`.

### Failure / refund

- All errors throw `PaymentError`. Network/API errors are wrapped with `cause` so the underlying reason is preserved.
- Refunds use `POST /v1.0/refund` (commit `0.3.0` change — was previously a stub returning fake success). See [Refunds](#refunds).

### Per-payment overrides

The plugin's `data` object can carry:

- `data.country` — overrides the adapter's default `country` (e.g. forwarding `'CZ'` while the global default is `'SK'`).
- `data.lang` — overrides `lang`.
- `data.comgateMethod` — overrides the `method` filter.

Used in the voxberg checkout to flip CZ shoppers to `cs` + `CZK` without reconfiguring the adapter.

## Refunds

```typescript
import { refundPayment } from 'payload-comgate-adapter/refund'
import type { RefundConfig, RefundResult } from 'payload-comgate-adapter/refund'

const result: RefundResult = await refundPayment(
  { merchantId: process.env.COMGATE_MERCHANT_ID!, secret: process.env.COMGATE_SECRET! },
  transactionId, // Comgate transId from the original payment
  12.5,          // amount in full currency units
  'EUR',
)

if (!result.success) {
  console.error(result.error)
}
```

Implementation notes:

- `POST /v1.0/refund`, `application/x-www-form-urlencoded`. Auth via Basic Auth header — the request body intentionally omits the `secret` field (Comgate would otherwise treat the call as ambiguous).
- Mock mode (test merchant id + test secret) skips the network call and returns `{ success: true, refundId: 'mock-refund-…' }`.
- Network errors throw `PaymentError('REFUND_FAILED')`; gateway-declined refunds return `{ success: false, error }`.

## Webhook (STATUS URL)

Comgate posts asynchronous payment status notifications to the merchant's STATUS URL. The plugin's `confirmOrder` is called from your route handler:

```
POST https://yourdomain.com/api/payments/comgate/webhook
```

Use timing-safe comparison on the `secret` form parameter, run the call through `confirmOrder` (idempotency + concurrency guards already protect against duplicate order creation), and return `200`.

## Transaction `comgate` group

Persisted on the `transactions` collection (visible when `paymentMethod === 'comgate'`):

| Field        | Type     | Description                          |
| ------------ | -------- | ------------------------------------ |
| `transId`    | `text`   | Comgate transaction id.              |
| `status`     | `text`   | Last seen Comgate status (`PAID` etc.). |
| `fee`        | `text`   | Comgate transaction fee.             |
| `payerName`  | `text`   | Payer name from Comgate.             |
| `payerAcc`   | `text`   | Payer account / card mask.           |

Additional internal fields: `confirming` (concurrency flag set during order creation).

Override via `groupOverrides.fields`.

## Mock mode

Activated automatically when both `merchantId` and `secret` are the documented mock literals (audit P1: do **not** import `MOCK_MERCHANT_ID` / `MOCK_SECRET` from the public API — they are intentionally kept private). For tests that need the literals, import them from `./utils/mock` inside this package.

In mock mode:

- No real API calls are made.
- `transId` is prefixed with `MOCK-`.
- `confirmOrder` always reports `PAID` with mock payer details.
- Refunds short-circuit to `{ success: true, refundId: 'mock-refund-…' }`.

Set `PAYMENT_MOCK_MODE=true` (or `mode: 'mock'` in refund config) instead of using literal credentials.

## TypeScript surface

```typescript
import { comgateAdapter } from 'payload-comgate-adapter'
import { comgateAdapterClient } from 'payload-comgate-adapter/client'
import { refundPayment } from 'payload-comgate-adapter/refund'
import type {
  ComgateAdapterArgs,
  ComgateAdapterClientArgs,
  ComgateCurrency,
  ComgateLanguage,
  ComgateCreateResponse,
  ComgateStatusResponse,
  ComgateWebhookPayload,
  ComgatePaymentRequest,
  InitiatePaymentReturnType,
  ConfirmOrderReturnType,
} from 'payload-comgate-adapter'
import type { RefundResult, RefundConfig } from 'payload-comgate-adapter/refund'
```

Plus the re-exported utilities: `PaymentError`, `COMGATE_API_URL`, `createAuthHeader`, `createPayment`, `getPaymentStatus`, `isMockMode`, `isMockTransactionId`.

## Recent changes

| Commit     | Change                                                                                                            |
| ---------- | ----------------------------------------------------------------------------------------------------------------- |
| `63b8d0ba` | P0 — switch to shared `PaymentError`, P1 thread `req` everywhere, drop body-secret on refund, drop `req.user` fallback. |
| `04cc11a1` | Widen `ComgateLanguage` + `ComgateCurrency` types in vendored adapter.                                           |
| `14d9324f` | Apple Pay / Google Pay wallet button support for Comgate markets.                                                 |
| `c0f5596b` | CZK multi-currency support for the CZ locale.                                                                     |
| `40502ef1` | Pass `req` to transaction create so the tenant hook can read `x-tenant-id`.                                       |
| `f7df6fdb` | `overrideAccess` on `confirmOrder` (matches CorvusPay).                                                           |
| `5573aa7b` | Link transactions to customer via email lookup (now in shared package).                                           |
| `a4764dc7` | Create orders from webhooks when the customer never returns to success URL.                                       |
| `441c8951` | Publish `0.3.0` alongside CorvusPay `0.3.0` and COD `0.1.0`.                                                      |
| `2209d361` | Convert to ESM-first (`type: module`).                                                                            |
| `5533b8a1` | Replace `Record` casts with shared utilities.                                                                     |
| `0.3.0`    | Real refund implementation via `/v1.0/refund` (was a stub returning fake success). 20-test suite for initiate/confirm/refund. PayloadCMS 3.81.0 tested. |
| `0.2.0`    | Pricing breakdown passthrough, billing+shipping address passthrough, cents/units fix, form-urlencoded body, Basic Auth header, `returnUrl`, `customerEmail` in confirm response, mock mode improvements, Next.js 16 canary compat. |
| `0.1.1`    | Initial release.                                                                                                  |

## Getting Comgate credentials

1. Register at the [Comgate portal](https://portal.comgate.cz).
2. Complete merchant verification.
3. Note your 6-digit Merchant ID and API secret.
4. Configure your STATUS URL + return URLs in the portal.

## License

MIT © [blaze IT s.r.o.](https://www.blazeit.sk/)

## Links

- [Comgate API documentation](https://apidoc.comgate.cz/en/)
- [Comgate help](https://help.comgate.cz/docs/en/)
- [Comgate currencies and languages](https://help.comgate.cz/docs/en/currencies-and-languages)
- [PayloadCMS ecommerce plugin](https://payloadcms.com/docs/ecommerce/overview)
