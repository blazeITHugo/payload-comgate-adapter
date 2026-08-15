import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getAppleDomainAssociation } from '../utils/api'

const FILE = '7B227073' + 'X'.repeat(40)

describe('getAppleDomainAssociation', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reads the JSON response shape', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ fileContent: `${FILE}\n` }), { status: 200 }),
    )

    // The trailing newline is trimmed — Apple rejects the file with one.
    await expect(getAppleDomainAssociation('123456', 'secret')).resolves.toBe(FILE)

    const [url, init] = vi.mocked(fetch).mock.calls[0]!
    expect(url).toBe('https://payments.comgate.cz/v1.0/appleDomainAssociation')
    const body = new URLSearchParams(init!.body as string)
    expect(body.get('merchant')).toBe('123456')
    expect(body.get('secret')).toBe('secret')
  })

  it('reads the form-urlencoded response shape', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(`code=0&message=OK&fileContent=${FILE}`, { status: 200 }),
    )

    await expect(getAppleDomainAssociation('123456', 'secret')).resolves.toBe(FILE)
  })

  it('throws a coded PaymentError when the file is missing', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('code=1401&message=Merchant not found', { status: 200 }),
    )

    await expect(getAppleDomainAssociation('123456', 'secret')).rejects.toMatchObject({
      code: 'COMGATE_APPLE_DOMAIN_ASSOCIATION_FAILED',
    })
  })

  it('throws on a non-2xx response even when a body parses', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ fileContent: FILE }), { status: 500 }),
    )

    await expect(getAppleDomainAssociation('123456', 'secret')).rejects.toThrow(
      /appleDomainAssociation failed \(500\)/,
    )
  })
})
