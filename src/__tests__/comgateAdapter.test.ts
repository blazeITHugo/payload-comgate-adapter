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
    // withPaymentLock: no beginTransaction → initTransaction is a no-op, and
    // the advisory lock runs on the pool (payload.db.drizzle) directly.
    db: {
      drizzle: { execute: vi.fn().mockResolvedValue(undefined) },
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
      // Transaction stored a customer during initiatePayment — order
      // should inherit it from the transaction (NOT from req.user).
      const tx = { ...mockTransaction, customer: 5 }
      payload.find.mockResolvedValue({ docs: [tx] })
      payload.create.mockResolvedValueOnce({ id: 200 })
      payload.update.mockResolvedValue({})

      const result = await adapter.confirmOrder({
        data: { transId: 'MOCK-42-1234567890' },
        ordersSlug: 'orders',
        req: createMockReq(payload, { id: 5 }),
        transactionsSlug: 'transactions',
        cartsSlug: 'carts',
      } as never)

      // Find transaction by comgate transId — re-read inside the payment
      // lock with full depth (the pre-lock read is a depth-0 snapshot)
      expect(payload.find).toHaveBeenCalledWith(
        expect.objectContaining({
          collection: 'transactions',
          where: { 'comgate.transId': { equals: 'MOCK-42-1234567890' } },
          depth: 2,
          overrideAccess: true,
        }),
      )

      // Order created with correct data
      expect(payload.create).toHaveBeenCalledOnce()
      const orderCall = payload.create.mock.calls[0][0]
      expect(orderCall.collection).toBe('orders')
      expect(orderCall.data.status).toBe('processing')
      expect(orderCall.data.amount).toBe(2000)
      expect(orderCall.data.currency).toBe('EUR')
      expect(orderCall.data.customerEmail).toBe('test@example.com')
      expect(orderCall.data.customer).toBe(5)

      // Cart marked as purchased AND detached from the customer in one update
      expect(payload.update).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 1,
          collection: 'carts',
          data: { purchasedAt: expect.any(String), customer: null },
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

    it('reads the stored customer off a populated relation, not just a bare id', async () => {
      const tx = { ...mockTransaction, customer: { id: 9, email: 'stored@example.com' } }
      payload.find.mockResolvedValue({ docs: [tx] })
      payload.create.mockResolvedValueOnce({ id: 203 })
      payload.update.mockResolvedValue({})

      await adapter.confirmOrder({
        data: { transId: 'MOCK-42-1234567890' },
        ordersSlug: 'orders',
        req: createMockReq(payload, { id: 999 }),
        transactionsSlug: 'transactions',
        cartsSlug: 'carts',
      } as never)

      // Never req.user (999) — the transaction's own customer wins.
      expect(payload.create.mock.calls[0][0].data.customer).toBe(9)
    })

    it('rejects a non-numeric order relation instead of typing it as a number', async () => {
      payload.find.mockResolvedValueOnce({
        docs: [{ ...mockTransaction, order: { id: 'ord_abc' } }],
      })

      await expect(
        adapter.confirmOrder({
          data: { transId: 'MOCK-42-1234567890' },
          ordersSlug: 'orders',
          req: createMockReq(payload),
          transactionsSlug: 'transactions',
          cartsSlug: 'carts',
        } as never),
      ).rejects.toMatchObject({ code: 'ORDER_RELATION_INVALID' })

      expect(payload.create).not.toHaveBeenCalled()
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
      payload.find.mockResolvedValue({ docs: [transactionWithPricing] })
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

      payload.find.mockResolvedValue({ docs: [transaction] })
      // Mock the atomic confirming update (race-condition guard)
      payload.update.mockResolvedValueOnce(transaction)

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

  describe('wallet methods (real API path)', () => {
    const realAdapter = () =>
      comgateAdapter({
        merchantId: 'real-merchant',
        secret: 'real-secret',
        serverUrl: 'https://example.com',
      })

    const initiate = (adapterUnderTest: ReturnType<typeof comgateAdapter>, comgateMethod: string) =>
      adapterUnderTest.initiatePayment({
        data: {
          currency: 'CZK',
          customerEmail: 'test@example.com',
          cart: makeCart(),
          comgateMethod,
        },
        req: createMockReq(payload),
        transactionsSlug: 'transactions',
      } as never)

    const sentMethod = (call: number) =>
      new URLSearchParams(vi.mocked(fetch).mock.calls[call]![1]!.body as string).get('method')

    it('sends the _REDIRECT wire code for the legacy bare wallet code', async () => {
      payload.create.mockResolvedValueOnce({ id: 42 })
      payload.update.mockResolvedValue({})
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response('code=0&message=OK&transId=TX-1&redirect=https%3A%2F%2Fpay.example', {
          status: 200,
        }),
      )

      await initiate(realAdapter(), 'APPLEPAY')

      expect(sentMethod(0)).toBe('APPLEPAY_REDIRECT')
    })

    it('retries with the default method when Comgate rejects the wallet (1109)', async () => {
      payload.create.mockResolvedValueOnce({ id: 42 })
      payload.update.mockResolvedValue({})
      vi.mocked(fetch)
        .mockResolvedValueOnce(
          new Response('code=1109&message=Invalid payment method [GOOGLEPAY_REDIRECT]', {
            status: 200,
          }),
        )
        .mockResolvedValueOnce(
          new Response('code=0&message=OK&transId=TX-2&redirect=https%3A%2F%2Fpay.example', {
            status: 200,
          }),
        )

      const result = await initiate(realAdapter(), 'GOOGLEPAY_REDIRECT')

      expect(sentMethod(0)).toBe('GOOGLEPAY_REDIRECT')
      expect(sentMethod(1)).toBe('ALL')
      expect(result.transactionID).toBe(42)
      expect(result.gatewayTransactionId).toBe('TX-2')
    })

    it('does not retry an error that is not 1109', async () => {
      payload.create.mockResolvedValueOnce({ id: 42 })
      payload.update.mockResolvedValue({})
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response('code=1400&message=Invalid request', { status: 200 }),
      )

      await expect(initiate(realAdapter(), 'APPLEPAY_REDIRECT')).rejects.toThrow(/1400/)
      expect(vi.mocked(fetch)).toHaveBeenCalledOnce()
    })
  })

  describe('injection points', () => {
    it('lets validateCart refuse the payment before any write', async () => {
      const guarded = comgateAdapter({
        merchantId: MOCK_MERCHANT_ID,
        secret: MOCK_SECRET,
        validateCart: (ctx) => {
          if (ctx.subtotalCents < 500000) throw new Error('Minimum order value not reached')
        },
      })

      await expect(
        guarded.initiatePayment({
          data: { currency: 'EUR', customerEmail: 'test@example.com', cart: makeCart() },
          req: createMockReq(payload),
          transactionsSlug: 'transactions',
        } as never),
      ).rejects.toThrow('Minimum order value not reached')

      expect(payload.create).not.toHaveBeenCalled()
    })

    it('charges the discount resolveDiscountCents returns, not the claim', async () => {
      const revalidating = comgateAdapter({
        merchantId: MOCK_MERCHANT_ID,
        secret: MOCK_SECRET,
        // The client claimed 1000.00; the host can only verify 100.00.
        resolveDiscountCents: () => 10000,
      })
      payload.create.mockResolvedValueOnce({ id: 60 })
      payload.update.mockResolvedValueOnce({})

      await revalidating.initiatePayment({
        data: {
          currency: 'CZK',
          customerEmail: 'buyer@example.com',
          cart: makeCart({ subtotal: 500000 }),
          discount: { calculatedAmount: 100000 },
        },
        req: createMockReq(payload),
        transactionsSlug: 'transactions',
      } as never)

      const createCall = payload.create.mock.calls[0][0]
      expect(createCall.data.discountAmount).toBe(100)
      expect(createCall.data.grandTotal).toBe(4900) // 5000 − 100
    })

    it('writes what enrichTransactionData returns', async () => {
      const enriched = comgateAdapter({
        merchantId: MOCK_MERCHANT_ID,
        secret: MOCK_SECRET,
        enrichTransactionData: (data, ctx) => ({
          ...data,
          tenant: 5,
          customerNote: ctx.data.customerNote,
        }),
      })
      payload.create.mockResolvedValueOnce({ id: 61 })
      payload.update.mockResolvedValueOnce({})

      await enriched.initiatePayment({
        data: {
          currency: 'EUR',
          customerEmail: 'test@example.com',
          cart: makeCart(),
          customerNote: 'ring the bell',
        },
        req: createMockReq(payload),
        transactionsSlug: 'transactions',
      } as never)

      const createCall = payload.create.mock.calls[0][0]
      expect(createCall.data.tenant).toBe(5)
      expect(createCall.data.customerNote).toBe('ring the bell')
      // The adapter's own fields survive the merge.
      expect(createCall.data.paymentMethod).toBe('comgate')
    })

    it('rejects a stale cart whose currency is not what the storefront displayed', async () => {
      await expect(
        adapter.initiatePayment({
          data: {
            currency: 'CZK',
            expectedCurrency: 'EUR',
            customerEmail: 'test@example.com',
            cart: makeCart(),
          },
          req: createMockReq(payload),
          transactionsSlug: 'transactions',
        } as never),
      ).rejects.toMatchObject({ code: 'CART_CURRENCY_MISMATCH' })

      expect(payload.create).not.toHaveBeenCalled()
    })

    it('prices order lines with resolveItemPricing and merges its extra fields', async () => {
      const bundled = comgateAdapter({
        merchantId: MOCK_MERCHANT_ID,
        secret: MOCK_SECRET,
        // A cart-written apportioned price the catalog cannot reproduce.
        resolveItemPricing: ({ item }) => ({
          price: (item.priceAtPurchase as number) * 100,
          originalPrice: 150000,
          extraFields: { bundleAssignmentKey: 'bundle-1' },
        }),
      })
      const tx = {
        id: 42,
        amount: 2000,
        currency: 'EUR',
        customerEmail: 'test@example.com',
        comgate: { transId: 'MOCK-42-1234567890' },
        cart: {
          id: 1,
          items: [
            { product: { id: 10, priceInEUR: 200000 }, quantity: 1, priceAtPurchase: 999 },
          ],
        },
      }
      payload.find.mockResolvedValue({ docs: [tx] })
      payload.create.mockResolvedValueOnce({ id: 400 })
      payload.update.mockResolvedValue({})

      await bundled.confirmOrder({
        data: { transId: 'MOCK-42-1234567890' },
        ordersSlug: 'orders',
        req: createMockReq(payload),
        transactionsSlug: 'transactions',
        cartsSlug: 'carts',
      } as never)

      expect(payload.create.mock.calls[0][0].data.items[0]).toMatchObject({
        product: 10,
        quantity: 1,
        priceAtPurchase: 999,
        originalPrice: 1500,
        bundleAssignmentKey: 'bundle-1',
      })
    })

    it('writes what enrichOrderData returns', async () => {
      const enriched = comgateAdapter({
        merchantId: MOCK_MERCHANT_ID,
        secret: MOCK_SECRET,
        enrichOrderData: (data, ctx) => ({
          ...data,
          tenant: ctx.transaction.tenant,
          transactions: [ctx.transaction.id],
        }),
      })
      const tx = {
        id: 42,
        tenant: 5,
        amount: 2000,
        currency: 'EUR',
        customerEmail: 'test@example.com',
        comgate: { transId: 'MOCK-42-1234567890' },
        cart: { id: 1, items: [] },
      }
      payload.find.mockResolvedValue({ docs: [tx] })
      payload.create.mockResolvedValueOnce({ id: 401 })
      payload.update.mockResolvedValue({})

      await enriched.confirmOrder({
        data: { transId: 'MOCK-42-1234567890' },
        ordersSlug: 'orders',
        req: createMockReq(payload),
        transactionsSlug: 'transactions',
        cartsSlug: 'carts',
      } as never)

      const orderData = payload.create.mock.calls[0][0].data
      expect(orderData.tenant).toBe(5)
      expect(orderData.transactions).toEqual([42])
      expect(orderData.status).toBe('processing')
    })

    it('leaves the payload untouched when no injection point is configured', async () => {
      const tx = {
        id: 42,
        tenant: 5,
        amount: 2000,
        currency: 'EUR',
        customerEmail: 'test@example.com',
        comgate: { transId: 'MOCK-42-1234567890' },
        cart: { id: 1, items: [] },
      }
      payload.find.mockResolvedValue({ docs: [tx] })
      payload.create.mockResolvedValueOnce({ id: 402 })
      payload.update.mockResolvedValue({})

      await adapter.confirmOrder({
        data: { transId: 'MOCK-42-1234567890' },
        ordersSlug: 'orders',
        req: createMockReq(payload),
        transactionsSlug: 'transactions',
        cartsSlug: 'carts',
      } as never)

      // Tenant pinning and the payment back-link are host concerns — the
      // generic adapter must not invent them.
      const orderData = payload.create.mock.calls[0][0].data
      expect('tenant' in orderData).toBe(false)
      expect('transactions' in orderData).toBe(false)
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
