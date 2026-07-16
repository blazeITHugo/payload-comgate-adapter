/**
 * Re-export the shared `PaymentError` so consumers of this adapter still
 * see `payload-comgate-adapter`'s `PaymentError` symbol — but it's the
 * SAME class identity as CorvusPay / COD, so `instanceof PaymentError`
 * works across adapter boundaries.
 *
 * Historical bug: this file used to define its OWN `class PaymentError`.
 * When a consumer imported the class from both `payload-comgate-adapter`
 * and `payload-corvuspay-adapter`, they got two distinct constructors —
 * an error thrown by CorvusPay did not match `instanceof` against the
 * Comgate-imported class. Sentry grouping + error branching became
 * nondeterministic.
 *
 * Do NOT reintroduce a local class here. Always import from
 * `payload-payment-shared`.
 */
export { PaymentError } from 'payload-payment-shared'
export type { PaymentErrorOptions } from 'payload-payment-shared'
