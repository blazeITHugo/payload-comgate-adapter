import type { ComgateCreateResponse, ComgateStatusResponse } from '../types'
import { resolvePaymentMode } from 'payload-payment-shared'

/**
 * Legacy mock merchant credentials for development.
 *
 * @deprecated Prefer `PAYMENT_MOCK_MODE=true` env var or explicit
 * `mode: 'mock'` adapter config. Literal credentials are rejected in
 * `NODE_ENV=production` without `ALLOW_MOCK_PAYMENTS=1`.
 */
export const MOCK_MERCHANT_ID = 'test-merchant-id'
export const MOCK_SECRET = 'test-secret'

/**
 * Check if mock mode is enabled.
 *
 * Delegates to `resolvePaymentMode` so prod deployments can't silently
 * slip into mock mode via a stray `.env.production` value.
 */
export function isMockMode(merchantId: string, secret: string): boolean {
  try {
    return resolvePaymentMode({ merchantId, secret }) === 'mock'
  } catch {
    return false
  }
}

/**
 * Check if transaction ID is from mock mode
 */
export function isMockTransactionId(transId: string): boolean {
  return transId.startsWith('MOCK-')
}

/**
 * Generate mock transaction ID
 */
export function generateMockTransId(refId: string): string {
  return `MOCK-${refId}-${Date.now()}`
}

/**
 * Create mock payment response
 */
export function createMockPaymentResponse(
  refId: string,
  customerEmail: string,
  serverUrl: string,
): ComgateCreateResponse {
  const mockTransId = generateMockTransId(refId)
  return {
    code: 0,
    message: 'OK',
    transId: mockTransId,
    redirect: `${serverUrl}/checkout/confirm-order?transId=${mockTransId}&email=${encodeURIComponent(customerEmail)}`,
  }
}

/**
 * Create mock status response for successful payment
 */
export function createMockStatusResponse(
  transId: string,
  amount: number,
  currency?: string,
): ComgateStatusResponse {
  return {
    code: 0,
    message: 'OK',
    status: 'PAID',
    transId: transId,
    price: String(amount),
    curr: currency,
    fee: '0',
    payerName: 'Mock Test User',
    payerAcc: 'MOCK-ACCOUNT',
  }
}
