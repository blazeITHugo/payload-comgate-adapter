/**
 * Re-export the shared, secure `resolveCustomerId` from
 * `payload-payment-shared`. Comgate's original "no email lookup for
 * guests" behaviour is now the SHARED default — COD + CorvusPay adopt
 * it instead of their old "look up by email" fork.
 */
export { resolveCustomerId } from 'payload-payment-shared'
