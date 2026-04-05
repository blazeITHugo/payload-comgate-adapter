import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { comgateAdapter } from '../comgateAdapter'
import { MOCK_MERCHANT_ID, MOCK_SECRET } from '../utils/mock'

// --- Mock helpers ---

function createMockPayload() {
  return {
    create: vi.fn(),
    find: vi.fn(),
    findByID: vi.fn(),
    update: vi.fn(),
    logger: {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
    },
  }
}

function createMockReq(payloadMock: ReturnType<typeof createMockPayload>, user?: unknown) {
  return {
    payload: payloadMock,
    user: user ?? undefined,
  }
}

function makeCart(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    subtotal: 200000, // 2000.00 in cents
    items: [
      {
        product: { id: 10, title: 'Protein Bar', priceInEUR: 1000 },
        quantity: 2,
      },
    ],
    ...overrides,
  }
}

// --- Tests ---

describe('comgateAdapter (mock mode)', () => {
  let adapter: ReturnType<typeof comgateAdapter>
  let payload: ReturnType<typeof createMockPayload>

  beforeEach(() => {
    adapter = comgateAdapter({
      merchantId: MOCK_MERCHANT_ID,
      secret: MOCK_SECRET,
      serverUrl: 'https://example.com',
    })
    payload = createMockPayload()
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('initiatePayment', () => {
    it('creates transaction and returns redirect URL in mock mode', async () => {
      payload.create.mockResolvedValueOnce({ id: 42 })
      payload.update.mockResolvedValueOnce({})

      const result = await adapter.initiatePayment({
        data: {
          currency: 'EUR',
          customerEmail: 'test@example.com',
          cart: makeCart(),
        },
        req: createMockReq(payload),
        transactionsSlug: 'transactions',
      } as never)

      // Transaction created
      expect(payload.create).toHaveBeenCalledOnce()
      const createCall = payload.create.mock.calls[0][0]
      expect(createCall.collection).toBe('transactions')
      expect(createCall.data.paymentMethod).toBe('comgate')
      expect(createCall.data.status).toBe('pending')
      expect(createCall.data.currency).toBe('EUR')
      expect(createCall.data.customerEmail).toBe('test@example.com')

      // Result has redirect and transactionID
      expect(result.transactionID).toBe(42)
      expect(result.redirect).toContain('https://example.com/checkout/confirm-order')
      expect(result.redirect).toContain('MOCK-')
      expect(result.message).toBe('Payment initiated successfully')

      // Mock mode should NOT call fetch
      expect(fetch).not.toHaveBeenCalled()

      // Transaction updated with comgate transId
      expect(payload.update).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 42,
          collection: 'transactions',
          data: { comgate: { transId: expect.stringContaining('MOCK-') } },
        }),
      )
    })

    it('calculates total correctly from cart with discount and shipping', async () => {
      payload.create.mockResolvedValueOnce({ id: 50 })
      payload.update.mockResolvedValueOnce({})

      await adapter.initiatePayment({
        data: {
          currency: 'CZK',
          customerEmail: 'buyer@example.com',
          cart: makeCart({ subtotal: 500000 }), // 5000.00 in cents
          discount: { calculatedAmount: 100000 }, // 1000.00 in cents
          shippingMethod: { cost: 150 }, // 150 CZK
        },
        req: createMockReq(payload),
        transactionsSlug: 'transactions',
      } as never)

      const createCall = payload.create.mock.calls[0][0]
      // subtotal: 500000, discount: 100000, shipping: 15000 cents
      // Total cents: max(0, 500000-100000) + 15000 = 415000 => 4150.00
      expect(createCall.data.grandTotal).toBe(4150)
      expect(createCall.data.subtotal).toBe(5000) // subtotalCents / 100
      expect(createCall.data.discountAmount).toBe(1000) // discountCents / 100
      expect(createCall.data.shippingCost).toBe(150)
    })

    it('rejects missing currency', async () => {
      await expect(
        adapter.initiatePayment({
          data: { customerEmail: 'test@example.com', cart: makeCart() },
          req: createMockReq(payload),
          transactionsSlug: 'transactions',
        } as never),
      ).rejects.toThrow('Currency is required.')
    })

    it('rejects missing email', async () => {
      await expect(
        adapter.initiatePayment({
          data: { currency: 'EUR', cart: makeCart() },
          req: createMockReq(payload),
          transactionsSlug: 'transactions',
        } as never),
      ).rejects.toThrow('Customer email is required.')
    })

    it('rejects missing cart', async () => {
      await expect(
        adapter.initiatePayment({
          data: { currency: 'EUR', customerEmail: 'test@example.com' },
          req: createMockReq(payload),
          transactionsSlug: 'transactions',
        } as never),
      ).rejects.toThrow('Valid cart with subtotal is required.')
    })

    it('marks transaction as failed on error', async () => {
      payload.create.mockResolvedValueOnce({ id: 88 })
      payload.update
        .mockRejectedValueOnce(new Error('Simulated update failure')) // comgate transId update fails
        .mockResolvedValueOnce({}) // status update to 'failed'

      await expect(
        adapter.initiatePayment({
          data: {
            currency: 'EUR',
            customerEmail: 'test@example.com',
            cart: makeCart(),
          },
          req: createMockReq(payload),
          transactionsSlug: 'transactions',
        } as never),
      ).rejects.toThrow()

      // Should attempt to mark transaction as failed
      const failedUpdate = payload.update.mock.calls.find(
        (call) => call[0]?.data?.status === 'failed',
      )
      expect(failedUpdate).toBeDefined()
    })
  })

  describe('confirmOrder', () => {
    const mockTransaction = {
      id: 42,
      amount: 2000,
      currency: 'EUR',
      customerEmail: 'test@example.com',
      comgate: { transId: 'MOCK-42-1234567890' },
      subtotal: 2000,
      discountAmount: 0,
      shippingCost: 0,
      grandTotal: 2000,
      freeShipping: true,
      cart: {
        id: 1,
        items: [
          {
            product: { id: 10, title: 'Protein Bar', priceInEUR: 100000 },
            quantity: 2,
          },
        ],
      },
    }

    it('verifies PAID status and creates order in mock mode', async () => {
      payload.find.mockResolvedValueOnce({ docs: [mockTransaction] })
      payload.create.mockResolvedValueOnce({ id: 200 })
      payload.update.mockResolvedValue({})

      const result = await adapter.confirmOrder({
        data: { transId: 'MOCK-42-1234567890' },
        ordersSlug: 'orders',
        req: createMockReq(payload, { id: 5 }),
        transactionsSlug: 'transactions',
        cartsSlug: 'carts',
      } as never)

      // Find transaction by comgate transId
      expect(payload.find).toHaveBeenCalledWith({
        collection: 'transactions',
        where: { 'comgate.transId': { equals: 'MOCK-42-1234567890' } },
        depth: 2,
      })

      // Order created with correct data
      expect(payload.create).toHaveBeenCalledOnce()
      const orderCall = payload.create.mock.calls[0][0]
      expect(orderCall.collection).toBe('orders')
      expect(orderCall.data.status).toBe('processing')
      expect(orderCall.data.amount).toBe(2000)
      expect(orderCall.data.currency).toBe('EUR')
      expect(orderCall.data.customerEmail).toBe('test@example.com')
      expect(orderCall.data.customer).toBe(5)

      // Cart marked as purchased
      expect(payload.update).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 1,
          collection: 'carts',
          data: { purchasedAt: expect.any(String) },
        }),
      )

      // Transaction updated with order link + PAID status
      expect(payload.update).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 42,
          collection: 'transactions',
          data: expect.objectContaining({
            order: 200,
            status: 'succeeded',
            comgate: expect.objectContaining({ status: 'PAID' }),
          }),
        }),
      )

      expect(result.orderID).toBe(200)
      expect(result.transactionID).toBe(42)
      expect(result.customerEmail).toBe('test@example.com')

      // Mock mode should NOT call fetch for status check
      expect(fetch).not.toHaveBeenCalled()
    })

    it('returns existing order if already confirmed (idempotency)', async () => {
      payload.find.mockResolvedValueOnce({
        docs: [{ ...mockTransaction, order: { id: 200 } }],
      })

      const result = await adapter.confirmOrder({
        data: { transId: 'MOCK-42-1234567890' },
        ordersSlug: 'orders',
        req: createMockReq(payload),
        transactionsSlug: 'transactions',
        cartsSlug: 'carts',
      } as never)

      expect(payload.create).not.toHaveBeenCalled()
      expect(result.message).toBe('Order already confirmed')
      expect(result.orderID).toBe(200)
      expect(result.transactionID).toBe(42)
    })

    it('handles idempotency with order as plain number', async () => {
      payload.find.mockResolvedValueOnce({
        docs: [{ ...mockTransaction, order: 200 }],
      })

      const result = await adapter.confirmOrder({
        data: { transId: 'MOCK-42-1234567890' },
        ordersSlug: 'orders',
        req: createMockReq(payload),
        transactionsSlug: 'transactions',
        cartsSlug: 'carts',
      } as never)

      expect(payload.create).not.toHaveBeenCalled()
      expect(result.orderID).toBe(200)
    })

    it('rejects when transaction not found', async () => {
      payload.find.mockResolvedValueOnce({ docs: [] })

      await expect(
        adapter.confirmOrder({
          data: { transId: 'MOCK-nonexistent' },
          ordersSlug: 'orders',
          req: createMockReq(payload),
          transactionsSlug: 'transactions',
          cartsSlug: 'carts',
        } as never),
      ).rejects.toThrow('Transaction not found')
    })

    it('rejects when transId is missing', async () => {
      await expect(
        adapter.confirmOrder({
          data: {},
          ordersSlug: 'orders',
          req: createMockReq(payload),
          transactionsSlug: 'transactions',
          cartsSlug: 'carts',
        } as never),
      ).rejects.toThrow('Comgate transaction ID is required')
    })

    it('copies pricing and address fields from transaction to order', async () => {
      const transactionWithPricing = {
        ...mockTransaction,
        subtotal: 2000,
        subtotalBeforeDiscount: 2500,
        discountAmount: 500,
        shippingCost: 150,
        grandTotal: 1650,
        freeShipping: false,
        shippingAddress: { city: 'Praha' },
        billingAddress: { city: 'Brno' },
        discount: { code: 'SAVE10', calculatedAmount: 50000 },
        shippingMethod: { name: 'DPD', cost: 150 },
      }
      payload.find.mockResolvedValueOnce({ docs: [transactionWithPricing] })
      payload.create.mockResolvedValueOnce({ id: 300 })
      payload.update.mockResolvedValue({})

      await adapter.confirmOrder({
        data: { transId: 'MOCK-42-1234567890' },
        ordersSlug: 'orders',
        req: createMockReq(payload),
        transactionsSlug: 'transactions',
        cartsSlug: 'carts',
      } as never)

      const orderData = payload.create.mock.calls[0][0].data
      expect(orderData.subtotal).toBe(2000)
      expect(orderData.subtotalBeforeDiscount).toBe(2500)
      expect(orderData.discountAmount).toBe(500)
      expect(orderData.shippingCost).toBe(150)
      expect(orderData.grandTotal).toBe(1650)
      expect(orderData.freeShipping).toBe(false)
      expect(orderData.shippingAddress).toEqual({ city: 'Praha' })
      expect(orderData.billingAddress).toEqual({ city: 'Brno' })
    })
  })

  describe('confirmOrder (non-PAID status)', () => {
    it('rejects non-PAID status from real API', async () => {
      // Use real credentials so it hits the actual API path
      const realAdapter = comgateAdapter({
        merchantId: 'real-merchant',
        secret: 'real-secret',
        serverUrl: 'https://example.com',
      })

      const transaction = {
        id: 42,
        amount: 2000,
        currency: 'EUR',
        customerEmail: 'test@example.com',
        comgate: { transId: 'REAL-tx-123' },
        cart: { id: 1, items: [] },
      }

      payload.find.mockResolvedValueOnce({ docs: [transaction] })

      // Mock Comgate status API returning CANCELLED
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(
          'code=0&message=OK&status=CANCELLED&transId=REAL-tx-123&price=200000&curr=EUR',
          { status: 200, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
        ),
      )

      await expect(
        realAdapter.confirmOrder({
          data: { transId: 'REAL-tx-123' },
          ordersSlug: 'orders',
          req: createMockReq(payload),
          transactionsSlug: 'transactions',
          cartsSlug: 'carts',
        } as never),
      ).rejects.toThrow(/Payment not completed.*CANCELLED/)
    })
  })

  describe('adapter shape', () => {
    it('returns correct adapter name and label', () => {
      expect(adapter.name).toBe('comgate')
      expect(adapter.label).toBe('Comgate')
    })

    it('allows custom label', () => {
      const custom = comgateAdapter({
        merchantId: MOCK_MERCHANT_ID,
        secret: MOCK_SECRET,
        label: 'Kartou online',
      })
      expect(custom.label).toBe('Kartou online')
    })

    it('has group field with condition on paymentMethod', () => {
      expect(adapter.group.name).toBe('comgate')
      expect(adapter.group.type).toBe('group')
      expect(adapter.group.admin?.condition?.({ paymentMethod: 'comgate' }, {} as never)).toBe(true)
      expect(adapter.group.admin?.condition?.({ paymentMethod: 'cod' }, {} as never)).toBe(false)
    })
  })
})
