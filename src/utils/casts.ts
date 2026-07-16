/**
 * Typed unwrappers for Payload documents returned by `payload.find` /
 * `payload.findByID` inside the Comgate adapter.
 *
 * Why a helper? The plugin-ecommerce contract gives us `transactionsSlug`
 * as a runtime string, so `payload.find({ collection: transactionsSlug })`
 * comes back with a generic doc shape rather than the adapter's narrow
 * `ComgateTransaction` interface. Rather than scatter `as unknown as
 * ComgateTransaction` casts across the adapter, this helper concentrates
 * the narrowing in one runtime-guarded boundary:
 *
 *   - The guard rejects non-object docs at runtime so a malformed Payload
 *     response surfaces as a `PaymentError`, not a silent NPE downstream.
 *   - The cast is a single `as T` — no `as unknown as`. TS accepts it
 *     because after the `typeof === 'object'` guard the input is `object`,
 *     and `T extends Record<string, unknown>` is structurally compatible.
 */

// The canonical implementation now lives in `payload-payment-shared`
// (single source of truth across all adapters). This file stays as a thin
// re-export so `./utils` barrel + adapter imports are unchanged.
export { asTransactionDoc } from 'payload-payment-shared'
