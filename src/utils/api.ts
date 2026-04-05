import type { ComgateCreateResponse, ComgateStatusResponse, ComgatePaymentRequest } from '../types'
import { PaymentError } from './errors'

/**
 * Comgate API base URL
 */
export const COMGATE_API_URL = 'https://payments.comgate.cz/v1.0'

/**
 * Create Basic Auth header for Comgate API
 */
export function createAuthHeader(merchantId: string, secret: string): string {
  const credentials = `${merchantId}:${secret}`
  const base64 = Buffer.from(credentials).toString('base64')
  return `Basic ${base64}`
}

/**
 * Create a new payment via Comgate API
 */
export async function createPayment(
  merchantId: string,
  secret: string,
  request: ComgatePaymentRequest,
): Promise<ComgateCreateResponse> {
  // Comgate API expects form-urlencoded data
  const formData = new URLSearchParams()
  formData.append('merchant', merchantId)
  formData.append('secret', secret)
  formData.append('test', request.test ? 'true' : 'false')
  formData.append('country', request.country)
  formData.append('price', String(request.price))
  formData.append('curr', request.curr)
  formData.append('label', request.label)
  formData.append('refId', request.refId)
  formData.append('method', request.method)
  formData.append('email', request.email)
  formData.append('lang', request.lang)
  formData.append('prepareOnly', 'true') // Get redirect URL without immediate redirect
  if (request.returnUrl) {
    formData.append('url', request.returnUrl) // Return URL after payment
  }
  if (request.preauth) {
    formData.append('preauth', 'true')
  }

  const apiUrl = `${COMGATE_API_URL}/create`

  const response = await fetch(apiUrl, {
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
  const transId = responseParams.get('transId') || undefined
  const redirect = responseParams.get('redirect') || undefined

  if (code !== 0) {
    throw new PaymentError(
      `Comgate error (${code}): ${message} | Raw: ${responseText.substring(0, 200)}`,
    )
  }

  return {
    code,
    message,
    transId,
    redirect,
  }
}

/**
 * Get payment status from Comgate API
 */
export async function getPaymentStatus(
  merchantId: string,
  secret: string,
  transId: string,
): Promise<ComgateStatusResponse> {
  // Comgate API expects form-urlencoded POST data
  const formData = new URLSearchParams()
  formData.append('merchant', merchantId)
  formData.append('secret', secret)
  formData.append('transId', transId)

  const response = await fetch(`${COMGATE_API_URL}/status`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: formData.toString(),
  })

  const responseText = await response.text()

  // Parse response (Comgate returns key=value pairs)
  const responseParams = new URLSearchParams(responseText)
  const code = parseInt(responseParams.get('code') || '-1', 10)
  const message = responseParams.get('message') || ''

  if (code !== 0) {
    throw new PaymentError(message || 'Error checking payment status')
  }

  return {
    code,
    message,
    status: responseParams.get('status') || undefined,
    transId: responseParams.get('transId') || undefined,
    price: responseParams.get('price') || undefined,
    curr: responseParams.get('curr') || undefined,
    fee: responseParams.get('fee') || undefined,
    payerName: responseParams.get('payerName') || undefined,
    payerAcc: responseParams.get('payerAcc') || undefined,
  }
}
