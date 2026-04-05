import { COMGATE_API_URL, createAuthHeader } from './utils/api'
import { PaymentError } from './utils/errors'
import { isMockMode } from './utils/mock'

export interface RefundResult {
  success: boolean
  refundId?: string
  error?: string
}

export interface RefundConfig {
  merchantId: string
  secret: string
}

/**
 * Refund a Comgate payment via the Comgate API.
 *
 * POST to /refund with form-urlencoded body:
 *   merchant, secret, transId, amount (cents), curr
 *
 * @param config - Adapter config with merchantId and secret
 * @param transactionId - Comgate transId from the original payment
 * @param amount - Amount to refund in currency units (e.g., 12.50 EUR)
 * @param currency - Currency code (EUR, CZK)
 * @returns RefundResult
 */
export async function refundPayment(
  config: RefundConfig,
  transactionId: string,
  amount: number,
  currency: string,
): Promise<RefundResult> {
  const { merchantId, secret } = config

  // Mock mode for testing
  if (isMockMode(merchantId, secret)) {
    return { success: true, refundId: `mock-refund-${Date.now()}` }
  }

  const formData = new URLSearchParams()
  formData.append('merchant', merchantId)
  formData.append('secret', secret)
  formData.append('transId', transactionId)
  formData.append('amount', String(Math.round(amount * 100)))
  formData.append('curr', currency.toUpperCase())

  try {
    const response = await fetch(`${COMGATE_API_URL}/refund`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: createAuthHeader(merchantId, secret),
      },
      body: formData.toString(),
    })

    const responseText = await response.text()

    // Parse response (Comgate returns key=value pairs)
    const responseParams = new URLSearchParams(responseText)
    const code = parseInt(responseParams.get('code') || '-1', 10)
    const message = responseParams.get('message') || ''

    if (code !== 0) {
      return {
        success: false,
        error: `Comgate refund error (${code}): ${message}`,
      }
    }

    return {
      success: true,
      refundId: transactionId,
    }
  } catch (error) {
    throw new PaymentError(
      `Comgate refund request failed: ${error instanceof Error ? error.message : String(error)}`,
      { code: 'REFUND_FAILED' },
    )
  }
}
