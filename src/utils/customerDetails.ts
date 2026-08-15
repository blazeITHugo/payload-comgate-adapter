import type { ComgateCategory, ComgateCustomerDetails } from '../types'

/**
 * Conservative field caps. Comgate doesn't publish per-field lengths for the
 * 3DS2 detail block, so we truncate well below anything a gateway would
 * reject rather than risk a `create` failure on a long address line.
 */
const MAX_NAME = 100
const MAX_STREET = 100
const MAX_CITY = 60
const MAX_POSTAL = 16
const MAX_PRODUCT_NAME = 60

/**
 * Shape of the address groups a host app stamps on carts / transactions /
 * orders. Read defensively — the adapter package has no compile-time
 * knowledge of the host's collection config.
 */
interface AddressLike {
  firstName?: unknown
  lastName?: unknown
  addressLine1?: unknown
  addressLine2?: unknown
  city?: unknown
  postalCode?: unknown
  country?: unknown
  phone?: unknown
}

function asAddress(value: unknown): AddressLike | undefined {
  return value && typeof value === 'object' ? (value as AddressLike) : undefined
}

/** Trim, collapse inner whitespace, truncate. Empty → undefined. */
function str(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const cleaned = value.replace(/\s+/g, ' ').trim()
  if (!cleaned) return undefined
  return cleaned.slice(0, max)
}

/** ISO 3166-1 alpha-2, uppercased. Anything else → undefined. */
function countryCode(value: unknown): string | undefined {
  const cleaned = str(value, 8)
  if (!cleaned || !/^[A-Za-z]{2}$/.test(cleaned)) return undefined
  return cleaned.toUpperCase()
}

/**
 * Comgate wants the phone in international format. A transaction is created
 * before any order exists, so whatever normalisation the host applies on the
 * order has not run yet: strip formatting characters and accept only a
 * well-formed E.164 number. Local-format numbers are dropped rather than
 * guessed at — a rejected `create` costs the sale, a missing `phone` costs
 * nothing.
 */
function e164Phone(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const stripped = value.replace(/[\s\-().]/g, '')
  if (!/^\+[1-9]\d{7,14}$/.test(stripped)) return undefined
  return stripped
}

function fullNameFrom(address: AddressLike | undefined): string | undefined {
  if (!address) return undefined
  const first = str(address.firstName, MAX_NAME)
  const last = str(address.lastName, MAX_NAME)
  const joined = [first, last].filter(Boolean).join(' ')
  return str(joined, MAX_NAME)
}

function streetFrom(address: AddressLike | undefined): string | undefined {
  if (!address) return undefined
  const line1 = str(address.addressLine1, MAX_STREET)
  const line2 = str(address.addressLine2, MAX_STREET)
  const joined = [line1, line2].filter(Boolean).join(', ')
  return str(joined, MAX_STREET)
}

export interface BuildCustomerDetailsArgs {
  /** `data.billingAddress` from the checkout payload. */
  billingAddress?: unknown
  /** `data.shippingAddress` from the checkout payload. */
  shippingAddress?: unknown
  /**
   * `data.shippingMethod` — a `pickupPointId` (parcel locker, pickup point)
   * means the order is collected, not home-delivered.
   */
  shippingMethod?: unknown
  /** Human-readable order content, shown as "Produkt" in the Comgate portal. */
  productName?: unknown
  /** Adapter's `category` config. */
  category?: ComgateCategory
}

/**
 * Map the checkout payload onto Comgate's optional customer-detail params.
 *
 * Pure and total: any missing / malformed input is simply omitted, so this can
 * never be the reason a payment fails to initiate. See `ComgateCustomerDetails`
 * for why sending them matters (3DS2 frictionless rate, disputes, portal).
 */
export function buildCustomerDetails({
  billingAddress,
  shippingAddress,
  shippingMethod,
  productName,
  category = 'PHYSICAL_GOODS_ONLY',
}: BuildCustomerDetailsArgs): ComgateCustomerDetails {
  const billing = asAddress(billingAddress)
  const shipping = asAddress(shippingAddress)

  const details: ComgateCustomerDetails = { category }

  // Name / phone: prefer the billing (cardholder) address, fall back to the
  // delivery one — plenty of checkouts fill only the address they ship to.
  const fullName = fullNameFrom(billing) ?? fullNameFrom(shipping)
  if (fullName) details.fullName = fullName

  const phone = e164Phone(billing?.phone) ?? e164Phone(shipping?.phone)
  if (phone) details.phone = phone

  const billingCity = str(billing?.city, MAX_CITY)
  if (billingCity) details.billingAddrCity = billingCity
  const billingStreet = streetFrom(billing)
  if (billingStreet) details.billingAddrStreet = billingStreet
  const billingPostal = str(billing?.postalCode, MAX_POSTAL)
  if (billingPostal) details.billingAddrPostalCode = billingPostal
  const billingCountry = countryCode(billing?.country)
  if (billingCountry) details.billingAddrCountry = billingCountry

  const pickupPointId =
    shippingMethod && typeof shippingMethod === 'object'
      ? str((shippingMethod as { pickupPointId?: unknown }).pickupPointId, 64)
      : undefined

  if (pickupPointId) {
    details.delivery = 'PICKUP'
  } else if (shipping) {
    // Comgate documents the homeDelivery* block as belonging to
    // HOME_DELIVERY, so only claim it when we actually have an address.
    const city = str(shipping.city, MAX_CITY)
    const street = streetFrom(shipping)
    const postal = str(shipping.postalCode, MAX_POSTAL)
    const country = countryCode(shipping.country)

    if (city || street || postal || country) {
      details.delivery = 'HOME_DELIVERY'
      if (city) details.homeDeliveryCity = city
      if (street) details.homeDeliveryStreet = street
      if (postal) details.homeDeliveryPostalCode = postal
      if (country) details.homeDeliveryCountry = country
    }
  }

  const name = str(productName, MAX_PRODUCT_NAME)
  if (name) details.name = name

  return details
}
