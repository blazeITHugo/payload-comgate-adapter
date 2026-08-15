export { PaymentError } from './errors'
export { asTransactionDoc } from './casts'
export { resolveCustomerId } from './resolveCustomerId'
export {
  COMGATE_API_URL,
  createAuthHeader,
  createPayment,
  getAppleDomainAssociation,
  getPaymentStatus,
} from './api'
export { buildCustomerDetails, type BuildCustomerDetailsArgs } from './customerDetails'
// NOTE: MOCK_MERCHANT_ID / MOCK_SECRET are *not* part of the public
// barrel anymore (audit P1). Tests inside this package import from
// './mock' directly if they still need the literals.
export {
  isMockMode,
  isMockTransactionId,
  generateMockTransId,
  createMockPaymentResponse,
  createMockStatusResponse,
} from './mock'
