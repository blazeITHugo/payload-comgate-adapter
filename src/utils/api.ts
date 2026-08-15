import type {
  ComgateCreateResponse,
  ComgateCustomerDetails,
  ComgateStatusResponse,
  ComgatePaymentRequest,
} from '../types'
import { PaymentError } from './errors'

/**
 * Comgate API base URL
 */
export const COMGATE_API_URL = 'https://payments.comgate.cz/v1.0'

/**
 * Optional 3DS2 / portal detail params forwarded verbatim when present.
 * Typed off `ComgateCustomerDetails` so a new field there is a compile error
 * here until it's listed (they're all plain strings on the wire).
 */
const CUSTOMER_DETAIL_KEYS: readonly (keyof ComgateCustomerDetails)[] = [
  'fullName',
  'phone',
  'billingAddrCity',
  'billingAddrStreet',
  'billingAddrPostalCode',
  'billingAddrCountry',
  'delivery',
  'homeDeliveryCity',
  'homeDeliveryStreet',
  'homeDeliveryPostalCode',
  'homeDeliveryCountry',
  'category',
  'name',
]

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
    // Per-outcome overrides. Without `url_cancelled` a cancelled payment also
    // lands on the confirm-order page, which has to fail a confirm call before
    // it can redirect the payer to the cancel page.
    formData.append('url_paid', request.returnUrl)
    formData.append('url_pending', request.pendingUrl || request.returnUrl)
    if (request.cancelUrl) {
      formData.append('url_cancelled', request.cancelUrl)
    }
  }
  // Optional customer / order detail. Comgate forwards these into the 3DS2
  // authentication request (higher frictionless rate) and shows them on the
  // payment detail in the portal. All are omitted when unavailable — see
  // `buildCustomerDetails`.
  for (const key of CUSTOMER_DETAIL_KEYS) {
    const value = request[key]
    if (value) {
      formData.append(key, value)
    }
  }
  if (request.preauth) {
    formData.append('preauth', 'true')
  }
  if (request.initRecurring) {
    // 'Y' enrols the card for recurring billing — Comgate returns a
    // `payerAcc` token on the status response that we store on the
    // transaction for later cron-driven charges.
    formData.append('initRecurring', request.initRecurring)
  }

  const apiUrl = `${COMGATE_API_URL}/create`

  const response = await fetch(apiUrl, {
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
  const transId = responseParams.get('transId') || undefined
  const redirect = responseParams.get('redirect') || undefined

  if (code !== 0) {
    // The numeric code rides on `details` so callers can branch on it — e.g.
    // 1109 ("Invalid payment method") is recoverable by retrying with the
    // eshop's default method instead of failing the whole checkout.
    throw new PaymentError(
      `Comgate error (${code}): ${message} | Raw: ${responseText.substring(0, 200)}`,
      { code: 'COMGATE_CREATE_REJECTED', details: { comgateCode: code, comgateMessage: message } },
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
 * Fetch the Apple Pay domain-association file for an eshop connection.
 *
 * Apple Pay in the Checkout SDK (wallet sheet inside your own checkout, no
 * redirect) requires Apple to verify the domain: the file has to be served
 * verbatim from
 * `https://<domain>/.well-known/apple-developer-merchantid-domain-association`
 * before the "verify" button in the Comgate portal will register it.
 *
 * Comgate mints the file per connection and **rotates its content**, so the
 * only safe integration is to fetch it on demand (cached, with a fallback)
 * rather than committing a static copy — hence this helper instead of a file
 * in `public/`.
 *
 * The response shape is not pinned by the docs the way `create` / `status`
 * are, so both encodings the Comgate API uses are accepted: JSON
 * (`{ fileContent }`) and the classic form-urlencoded `key=value` body.
 */
export async function getAppleDomainAssociation(
  merchantId: string,
  secret: string,
): Promise<string> {
  const formData = new URLSearchParams()
  formData.append('merchant', merchantId)
  formData.append('secret', secret)

  const response = await fetch(`${COMGATE_API_URL}/appleDomainAssociation`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formData.toString(),
  })

  const responseText = await response.text()

  let fileContent: string | undefined
  let message = ''
  try {
    const json = JSON.parse(responseText) as { fileContent?: string; message?: string }
    fileContent = json.fileContent
    message = json.message || ''
  } catch {
    const params = new URLSearchParams(responseText)
    fileContent = params.get('fileContent') || undefined
    message = params.get('message') || ''
  }

  if (!response.ok || !fileContent) {
    throw new PaymentError(
      `Comgate appleDomainAssociation failed (${response.status})${message ? `: ${message}` : ''}`,
      { code: 'COMGATE_APPLE_DOMAIN_ASSOCIATION_FAILED' },
    )
  }

  // Apple rejects the file if it carries a trailing newline — trim here so no
  // caller has to remember (the wire body may arrive with one).
  return fileContent.trim()
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
