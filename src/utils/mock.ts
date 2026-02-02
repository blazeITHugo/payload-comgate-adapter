import type { ComgateCreateResponse, ComgateStatusResponse } from '../types'

/**
 * Mock merchant credentials for development
 */
export const MOCK_MERCHANT_ID = 'test-merchant-id'
export const MOCK_SECRET = 'test-secret'

/**
 * Check if mock mode is enabled based on credentials
 */
export function isMockMode(merchantId: string, secret: string): boolean {
  return merchantId === MOCK_MERCHANT_ID && secret === MOCK_SECRET
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
  serverUrl: string
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
  currency?: string
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
