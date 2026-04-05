export { PaymentError } from './errors'
export { COMGATE_API_URL, createAuthHeader, createPayment, getPaymentStatus } from './api'
export {
  MOCK_MERCHANT_ID,
  MOCK_SECRET,
  isMockMode,
  isMockTransactionId,
  generateMockTransId,
  createMockPaymentResponse,
  createMockStatusResponse,
} from './mock'
