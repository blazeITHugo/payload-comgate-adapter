import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { refundPayment } from '../refund'
import { MOCK_MERCHANT_ID, MOCK_SECRET } from '../utils/mock'

describe('Comgate refundPayment', () => {
  const realConfig = {
    merchantId: 'real-merchant',
    secret: 'real-secret',
  }
  const mockConfig = {
    merchantId: MOCK_MERCHANT_ID,
    secret: MOCK_SECRET,
  }

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns success without calling fetch in mock mode', async () => {
    const result = await refundPayment(mockConfig, 'MOCK-tx-123', 10.5, 'EUR')

    expect(result.success).toBe(true)
    expect(result.refundId).toMatch(/^mock-refund-/)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('calls Comgate API with correct form-urlencoded params', async () => {
    const mockResponse = new Response('code=0&message=OK', {
      status: 200,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    })
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse)

    const result = await refundPayment(realConfig, 'TX-ABC-123', 24.99, 'eur')

    expect(result.success).toBe(true)
    expect(result.refundId).toBe('TX-ABC-123')

    expect(fetch).toHaveBeenCalledOnce()
    const [url, options] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe('https://payments.comgate.cz/v1.0/refund')
    expect(options?.method).toBe('POST')

    // Verify form body
    const body = new URLSearchParams(options?.body as string)
    expect(body.get('merchant')).toBe('real-merchant')
    expect(body.get('secret')).toBe('real-secret')
    expect(body.get('transId')).toBe('TX-ABC-123')
    expect(body.get('amount')).toBe('2499') // cents
    expect(body.get('curr')).toBe('EUR')
  })

  it('returns error when Comgate responds with non-zero code', async () => {
    const mockResponse = new Response('code=1400&message=Transaction+not+found', {
      status: 200,
    })
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse)

    const result = await refundPayment(realConfig, 'TX-BAD', 10, 'CZK')

    expect(result.success).toBe(false)
    expect(result.error).toContain('1400')
    expect(result.error).toContain('Transaction not found')
  })

  it('throws PaymentError on network failure', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('Network error'))

    await expect(
      refundPayment(realConfig, 'TX-NET', 5, 'EUR'),
    ).rejects.toThrow(/Comgate refund request failed.*Network error/)
  })
})
