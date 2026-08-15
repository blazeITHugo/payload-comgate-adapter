import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { buildCustomerDetails } from '../utils/customerDetails'
import { comgateAdapter } from '../comgateAdapter'

const billing = {
  firstName: 'Ladislav',
  lastName: 'Novák',
  addressLine1: 'Hlavná 12',
  addressLine2: 'byt 4',
  city: 'Bratislava',
  postalCode: '81101',
  country: 'sk',
  phone: '+421 900 123 456',
}

describe('buildCustomerDetails', () => {
  it('maps a full billing + shipping payload', () => {
    const details = buildCustomerDetails({
      billingAddress: billing,
      shippingAddress: {
        firstName: 'Ladislav',
        lastName: 'Novák',
        addressLine1: 'Vedľajšia 8',
        city: 'Košice',
        postalCode: '04001',
        country: 'SK',
      },
      shippingMethod: { code: 'courier', cost: 3.9 },
      productName: 'Whey 100',
    })

    expect(details).toEqual({
      category: 'PHYSICAL_GOODS_ONLY',
      fullName: 'Ladislav Novák',
      phone: '+421900123456',
      billingAddrCity: 'Bratislava',
      billingAddrStreet: 'Hlavná 12, byt 4',
      billingAddrPostalCode: '81101',
      billingAddrCountry: 'SK',
      delivery: 'HOME_DELIVERY',
      homeDeliveryCity: 'Košice',
      homeDeliveryStreet: 'Vedľajšia 8',
      homeDeliveryPostalCode: '04001',
      homeDeliveryCountry: 'SK',
      name: 'Whey 100',
    })
  })

  it('reports PICKUP and omits the delivery address for a pickup point', () => {
    const details = buildCustomerDetails({
      billingAddress: billing,
      shippingAddress: { city: 'Brno', country: 'CZ' },
      shippingMethod: { code: 'pickup-point', pickupPointId: '1234' },
    })

    expect(details.delivery).toBe('PICKUP')
    expect(details.homeDeliveryCity).toBeUndefined()
    expect(details.homeDeliveryCountry).toBeUndefined()
  })

  it('falls back to the shipping address for name and phone', () => {
    const details = buildCustomerDetails({
      billingAddress: undefined,
      shippingAddress: { firstName: 'Eva', lastName: 'Malá', phone: '+420777888999' },
    })

    expect(details.fullName).toBe('Eva Malá')
    expect(details.phone).toBe('+420777888999')
    expect(details.billingAddrCity).toBeUndefined()
  })

  it('drops phones that are not E.164 rather than guessing', () => {
    // Local format — a host normalises this on the Order, but a transaction is
    // created before any order exists.
    expect(buildCustomerDetails({ billingAddress: { phone: '0900 123 456' } }).phone).toBeUndefined()
    expect(buildCustomerDetails({ billingAddress: { phone: '+421' } }).phone).toBeUndefined()
    expect(buildCustomerDetails({ billingAddress: { phone: 12345 } }).phone).toBeUndefined()
  })

  it('drops country codes that are not ISO alpha-2', () => {
    expect(
      buildCustomerDetails({ billingAddress: { ...billing, country: 'Slovensko' } })
        .billingAddrCountry,
    ).toBeUndefined()
  })

  it('never throws on junk input and never claims a delivery it has no data for', () => {
    expect(
      buildCustomerDetails({
        billingAddress: 'not-an-object',
        shippingAddress: null,
        shippingMethod: 42,
        productName: { nope: true },
      }),
    ).toEqual({ category: 'PHYSICAL_GOODS_ONLY' })
  })

  it('truncates long values and collapses whitespace', () => {
    const details = buildCustomerDetails({
      billingAddress: { firstName: '  Ladislav   ', lastName: 'Novák ', city: 'x'.repeat(200) },
      productName: 'y'.repeat(200),
    })

    expect(details.fullName).toBe('Ladislav Novák')
    expect(details.billingAddrCity?.length).toBe(60)
    expect(details.name?.length).toBe(60)
  })

  it('honours a category override', () => {
    expect(buildCustomerDetails({ category: 'OTHER' }).category).toBe('OTHER')
  })
})

// --- The details actually reach the Comgate `create` call ---

function createMockPayload() {
  return {
    create: vi.fn(),
    find: vi.fn(),
    findByID: vi.fn(),
    update: vi.fn(),
    logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
    db: { drizzle: { execute: vi.fn().mockResolvedValue(undefined) } },
  }
}

describe('initiatePayment → Comgate create body', () => {
  let adapter: ReturnType<typeof comgateAdapter>
  let payload: ReturnType<typeof createMockPayload>

  beforeEach(() => {
    // Real (non-mock) credentials so the adapter hits the HTTP path.
    adapter = comgateAdapter({
      merchantId: '123456',
      secret: 'real-secret-value',
      serverUrl: 'https://shop.example.com',
    })
    payload = createMockPayload()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        text: async () =>
          'code=0&message=OK&transId=AAAA-BBBB-CCCC&redirect=https%3A%2F%2Fpayments.comgate.cz%2Fclient%2Finstructions%2Findex',
      }),
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  async function initiate() {
    payload.create.mockResolvedValueOnce({ id: 11 })
    payload.update.mockResolvedValueOnce({})

    await adapter.initiatePayment({
      data: {
        currency: 'CZK',
        customerEmail: 'ladislav@example.com',
        cart: { id: 1, subtotal: 247140, items: [] },
        billingAddress: billing,
        shippingAddress: { ...billing, city: 'Praha', postalCode: '11000', country: 'CZ' },
        shippingMethod: { code: 'courier', cost: 0 },
        productName: 'Whey 100 +2',
      },
      req: { payload, user: undefined },
      transactionsSlug: 'transactions',
    } as never)

    const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    return new URLSearchParams(init.body as string)
  }

  it('sends the customer detail params', async () => {
    const body = await initiate()

    expect(body.get('fullName')).toBe('Ladislav Novák')
    expect(body.get('phone')).toBe('+421900123456')
    expect(body.get('billingAddrCity')).toBe('Bratislava')
    expect(body.get('billingAddrStreet')).toBe('Hlavná 12, byt 4')
    expect(body.get('billingAddrPostalCode')).toBe('81101')
    expect(body.get('billingAddrCountry')).toBe('SK')
    expect(body.get('delivery')).toBe('HOME_DELIVERY')
    expect(body.get('homeDeliveryCity')).toBe('Praha')
    expect(body.get('homeDeliveryCountry')).toBe('CZ')
    expect(body.get('category')).toBe('PHYSICAL_GOODS_ONLY')
    expect(body.get('name')).toBe('Whey 100 +2')
  })

  it('keeps the existing required params and splits the outcome URLs', async () => {
    const body = await initiate()

    expect(body.get('merchant')).toBe('123456')
    expect(body.get('price')).toBe('247140')
    expect(body.get('curr')).toBe('CZK')
    expect(body.get('refId')).toBe('11')
    expect(body.get('label')).toBe('Obj-11')
    expect(body.get('prepareOnly')).toBe('true')
    expect(body.get('url')).toBe('https://shop.example.com/checkout/confirm-order')
    expect(body.get('url_paid')).toBe('https://shop.example.com/checkout/confirm-order')
    expect(body.get('url_pending')).toBe('https://shop.example.com/checkout/confirm-order')
    expect(body.get('url_cancelled')).toBe('https://shop.example.com/checkout/cancel')
  })

  it('omits detail params when the checkout has no address', async () => {
    payload.create.mockResolvedValueOnce({ id: 12 })
    payload.update.mockResolvedValueOnce({})

    await adapter.initiatePayment({
      data: {
        currency: 'EUR',
        customerEmail: 'guest@example.com',
        cart: { id: 2, subtotal: 1000, items: [] },
      },
      req: { payload, user: undefined },
      transactionsSlug: 'transactions',
    } as never)

    const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    const body = new URLSearchParams(init.body as string)

    expect(body.get('fullName')).toBeNull()
    expect(body.get('phone')).toBeNull()
    expect(body.get('delivery')).toBeNull()
    // Category is a constant, so it always rides along.
    expect(body.get('category')).toBe('PHYSICAL_GOODS_ONLY')
    expect(body.get('email')).toBe('guest@example.com')
  })

  it('sends the configured category override', async () => {
    const otherAdapter = comgateAdapter({
      merchantId: '123456',
      secret: 'real-secret-value',
      serverUrl: 'https://shop.example.com',
      category: 'OTHER',
    })
    payload.create.mockResolvedValueOnce({ id: 13 })
    payload.update.mockResolvedValueOnce({})

    await otherAdapter.initiatePayment({
      data: {
        currency: 'EUR',
        customerEmail: 'guest@example.com',
        cart: { id: 3, subtotal: 1000, items: [] },
      },
      req: { payload, user: undefined },
      transactionsSlug: 'transactions',
    } as never)

    const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(new URLSearchParams(init.body as string).get('category')).toBe('OTHER')
  })
})
