import type { PaymentAdapter } from '@payloadcms/plugin-ecommerce/types'
import type { Field, GroupField } from 'payload'
import type { ComgateAdapterArgs, ComgatePaymentRequest } from './types'
import {
  PaymentError,
  createPayment,
  getPaymentStatus,
  isMockMode,
  isMockTransactionId,
  createMockPaymentResponse,
  createMockStatusResponse,
} from './utils'

/**
 * Comgate payment adapter for PayloadCMS ecommerce plugin
 *
 * @example
 * ```typescript
 * import { comgateAdapter } from 'payload-comgate-adapter'
 *
 * ecommercePlugin({
 *   payments: {
 *     paymentMethods: [
 *       comgateAdapter({
 *         merchantId: process.env.COMGATE_MERCHANT_ID!,
 *         secret: process.env.COMGATE_SECRET!,
 *         testMode: true,
 *         country: 'SK',
 *         lang: 'sk',
 *       }),
 *     ],
 *   },
 * })
 * ```
 */
export const comgateAdapter = (config: ComgateAdapterArgs): PaymentAdapter => {
  const {
    merchantId,
    secret,
    testMode = false,
    country = 'CZ',
    lang = 'cs',
    preauth = false,
    method = 'ALL',
    label = 'Comgate',
    serverUrl,
    groupOverrides,
  } = config

  const mockMode = isMockMode(merchantId, secret)

  const getServerUrl = (): string => {
    return serverUrl || process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000'
  }

  /**
   * Initiate a payment with Comgate
   */
  const initiatePayment: PaymentAdapter['initiatePayment'] = async ({
    data,
    req,
    transactionsSlug,
  }) => {
    const payload = req.payload

    // Validate required data
    const currency = data.currency
    const cart = data.cart as
      | { id: string | number; subtotal: number; items: unknown[] }
      | undefined
    const customerEmail =
      data.customerEmail || (req.user?.collection === 'users' ? req.user.email : undefined)

    if (!currency) {
      throw new PaymentError('Currency is required.')
    }

    if (!customerEmail) {
      throw new PaymentError('Customer email is required.')
    }

    if (!cart || typeof cart.subtotal !== 'number') {
      throw new PaymentError('Valid cart with subtotal is required.')
    }

    // Calculate total (additionalData can include discount, shipping, etc.)
    // All monetary values from additionalData are in the ORDER'S CURRENCY (not always EUR)
    const additionalData = data as Record<string, unknown>
    const discount = additionalData.discount as
      | { calculatedAmount?: number; [key: string]: unknown }
      | undefined
    const shippingMethod = additionalData.shippingMethod as
      | { cost?: number; [key: string]: unknown }
      | undefined
    const pricingData = additionalData.pricing as
      | {
          subtotal?: number
          discountAmount?: number
          shippingCost?: number
          grandTotal?: number
          freeShipping?: boolean
        }
      | undefined

    // Use explicit pricing data if provided (preferred), otherwise calculate from cart
    const subtotalCents = cart.subtotal // CENTS from ecommerce plugin
    const discountCents = discount?.calculatedAmount || 0 // CENTS
    const shippingCostValue = pricingData?.shippingCost ?? shippingMethod?.cost ?? 0
    const shippingCents = Math.round(shippingCostValue * 100)

    const cartTotalCents = Math.max(0, subtotalCents - discountCents) + shippingCents
    const cartTotal = cartTotalCents / 100

    // Pricing breakdown in order currency
    const subtotalInCurrency = subtotalCents / 100
    const discountInCurrency = discountCents / 100
    const grandTotalInCurrency = pricingData?.grandTotal ?? cartTotal

    let transaction: { id: string | number } | undefined

    try {
      // Create transaction record with complete pricing breakdown
      transaction = await payload.create({
        collection: transactionsSlug as 'transactions',
        data: {
          paymentMethod: 'comgate' as const,
          status: 'pending' as const,
          amount: grandTotalInCurrency,
          currency: currency.toUpperCase() as 'EUR' | 'CZK',
          cart: typeof cart.id === 'number' ? cart.id : undefined,
          customerEmail,
          // Pricing breakdown
          subtotal: subtotalInCurrency,
          subtotalBeforeDiscount: subtotalInCurrency,
          discountAmount: discountInCurrency,
          shippingCost: shippingCostValue,
          grandTotal: grandTotalInCurrency,
          freeShipping: pricingData?.freeShipping ?? shippingCostValue === 0,
          // Discount details
          ...(additionalData.discount ? { discount: additionalData.discount } : {}),
          // Shipping method details
          ...(additionalData.shippingMethod
            ? { shippingMethod: additionalData.shippingMethod }
            : {}),
          // Addresses
          ...(additionalData.shippingAddress
            ? { shippingAddress: additionalData.shippingAddress }
            : {}),
          ...(additionalData.billingAddress
            ? { billingAddress: additionalData.billingAddress }
            : {}),
        },
      })

      const refId = String(transaction.id)
      const paymentLabel = `Obj-${refId.substring(0, 12)}`
      const returnUrl = `${getServerUrl()}/checkout/confirm-order`
      const price = cartTotalCents // Already in cents

      let transId: string
      let redirect: string

      if (mockMode) {
        payload.logger.info('🧪 MOCK MODE: Simulating Comgate payment creation')
        const mockResponse = createMockPaymentResponse(refId, customerEmail, getServerUrl())
        transId = mockResponse.transId!
        redirect = mockResponse.redirect!
        payload.logger.info({ msg: '🧪 MOCK: Payment created', transId, redirect })
      } else {
        const request: ComgatePaymentRequest = {
          test: testMode,
          country,
          price,
          curr: currency.toUpperCase(),
          label: paymentLabel,
          refId,
          method,
          email: customerEmail,
          lang,
          preauth,
          returnUrl,
        }

        const response = await createPayment(merchantId, secret, request)
        transId = response.transId!
        redirect = response.redirect!
      }

      // Update transaction with Comgate transId
      await payload.update({
        id: transaction.id,
        collection: transactionsSlug as 'transactions',
        data: {
          comgate: { transId },
        },
      })

      return {
        message: 'Payment initiated successfully',
        redirect,
        transactionID: transaction.id,
      }
    } catch (error) {
      payload.logger.error(error, 'Error initiating payment with Comgate')

      // Mark transaction as failed
      if (transaction?.id) {
        await payload
          .update({
            collection: transactionsSlug as 'transactions',
            id: transaction.id,
            data: { status: 'failed' as const },
          })
          .catch((e) => payload.logger.error(e, 'Failed to update transaction status'))
      }

      if (error instanceof PaymentError) {
        throw error
      }

      throw new PaymentError(
        error instanceof Error ? error.message : 'Unknown error initiating payment',
      )
    }
  }

  /**
   * Confirm order after successful Comgate payment
   */
  const confirmOrder: PaymentAdapter['confirmOrder'] = async ({
    data,
    ordersSlug = 'orders',
    req,
    transactionsSlug = 'transactions',
    cartsSlug = 'carts',
  }) => {
    const payload = req.payload
    const transId = data.transId as string

    if (!transId) {
      throw new PaymentError('Comgate transaction ID is required')
    }

    try {
      // Find existing transaction with populated cart
      const transactionsResults = await payload.find({
        collection: transactionsSlug as 'transactions',
        where: {
          'comgate.transId': { equals: transId },
        },
        depth: 2, // Populate cart and its items/products
      })

      if (transactionsResults.docs.length === 0) {
        throw new PaymentError('Transaction not found')
      }

      interface ComgateTransaction {
        id: string | number
        amount: number
        currency?: string
        customerEmail?: string
        cart?: {
          id: string | number
          items: Array<{ product: unknown; variant?: unknown; quantity: number }>
        }
        comgate?: Record<string, unknown>
        [key: string]: unknown
      }
      const transaction = transactionsResults.docs[0] as unknown as ComgateTransaction

      // Idempotency guard: if order already created for this transaction, return it
      if (transaction.order) {
        const existingOrderId =
          typeof transaction.order === 'object' && transaction.order !== null
            ? (transaction.order as { id: number }).id
            : (transaction.order as number)
        return {
          message: 'Order already confirmed',
          orderID: existingOrderId,
          transactionID: transaction.id as number,
          customerEmail: transaction.customerEmail,
        }
      }

      // Verify payment status
      let paymentStatus: string
      let fee: string | undefined
      let payerName: string | undefined
      let payerAcc: string | undefined

      if (isMockTransactionId(transId)) {
        payload.logger.info('🧪 MOCK MODE: Simulating successful payment verification')
        const mockStatus = createMockStatusResponse(
          transId,
          transaction.amount,
          transaction.currency,
        )
        paymentStatus = mockStatus.status!
        fee = mockStatus.fee
        payerName = mockStatus.payerName
        payerAcc = mockStatus.payerAcc
      } else {
        const statusResponse = await getPaymentStatus(merchantId, secret, transId)

        if (statusResponse.status !== 'PAID') {
          throw new PaymentError(`Payment not completed. Status: ${statusResponse.status}`)
        }

        paymentStatus = statusResponse.status
        fee = statusResponse.fee
        payerName = statusResponse.payerName
        payerAcc = statusResponse.payerAcc
      }

      // Extract order items from cart with prices
      const priceField = `priceIn${transaction.currency || 'EUR'}`
      const salePriceField = `salePriceIn${transaction.currency || 'EUR'}`

      const orderItems = (transaction.cart?.items?.map((item) => {
        const product =
          typeof item.product === 'object' && item.product !== null
            ? (item.product as Record<string, unknown>)
            : null
        const variant =
          item.variant && typeof item.variant === 'object'
            ? (item.variant as Record<string, unknown>)
            : null
        const source = variant || product
        const regularPrice = (source?.[priceField] as number) || 0
        const salePrice = source?.saleEnabled ? (source?.[salePriceField] as number) : null
        const price = salePrice && salePrice < regularPrice ? salePrice : regularPrice

        return {
          product: product ? (product.id as number) : item.product,
          variant: variant ? (variant.id as number) : item.variant,
          quantity: item.quantity,
          priceAtPurchase: price / 100, // cents → decimal
        }
      }) || []) as Array<{ product?: number | null; variant?: number | null; quantity: number; priceAtPurchase: number }>

      // Create order with complete pricing + address data from transaction
      const transactionData = transaction as Record<string, unknown>
      const orderData = {
        customer: req.user?.id || undefined,
        customerEmail: transaction.customerEmail,
        items: orderItems,
        amount: transaction.amount,
        currency: transaction.currency,
        status: 'processing',
        // Pricing breakdown
        subtotal: transactionData.subtotal,
        subtotalBeforeDiscount: transactionData.subtotalBeforeDiscount,
        discountAmount: transactionData.discountAmount,
        shippingCost: transactionData.shippingCost,
        grandTotal: transactionData.grandTotal,
        freeShipping: transactionData.freeShipping,
        // Discount details
        ...(transactionData.discount ? { discount: transactionData.discount } : {}),
        // Shipping method
        ...(transactionData.shippingMethod
          ? { shippingMethod: transactionData.shippingMethod }
          : {}),
        // Addresses
        ...(transactionData.shippingAddress
          ? { shippingAddress: transactionData.shippingAddress }
          : {}),
        ...(transactionData.billingAddress
          ? { billingAddress: transactionData.billingAddress }
          : {}),
      }

      const order = await payload.create({
        collection: ordersSlug as 'orders',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data: orderData as any,
      })

      // Mark cart as purchased
      if (transaction.cart?.id) {
        await payload.update({
          id: transaction.cart.id,
          collection: cartsSlug as 'carts',
          data: { purchasedAt: new Date().toISOString() },
        })
      }

      // Update transaction
      await payload.update({
        id: transaction.id,
        collection: transactionsSlug as 'transactions',
        data: {
          order: order.id,
          status: 'succeeded' as const,
          comgate: {
            ...transaction.comgate,
            status: paymentStatus,
            fee,
            payerName,
            payerAcc,
          },
        },
      })

      return {
        message: 'Order confirmed successfully',
        orderID: order.id as number,
        transactionID: transaction.id as number,
        customerEmail: transaction.customerEmail,
      }
    } catch (error) {
      payload.logger.error(error, 'Error confirming order with Comgate')

      if (error instanceof PaymentError) {
        throw error
      }

      throw new PaymentError(
        error instanceof Error ? error.message : 'Unknown error confirming order',
      )
    }
  }

  // Define Comgate group field for transaction data
  const baseFields: Field[] = [
    {
      name: 'transId',
      type: 'text',
      label: 'Comgate Transaction ID',
      admin: { readOnly: true },
    },
    {
      name: 'status',
      type: 'text',
      label: 'Payment Status',
      admin: { readOnly: true },
    },
    {
      name: 'fee',
      type: 'text',
      label: 'Transaction Fee',
      admin: { readOnly: true },
    },
    {
      name: 'payerName',
      type: 'text',
      label: 'Payer Name',
      admin: { readOnly: true },
    },
    {
      name: 'payerAcc',
      type: 'text',
      label: 'Payer Account',
      admin: { readOnly: true },
    },
  ]

  let finalFields: Field[] = baseFields

  if (groupOverrides?.fields) {
    if (typeof groupOverrides.fields === 'function') {
      finalFields = groupOverrides.fields({ defaultFields: baseFields })
    } else {
      finalFields = groupOverrides.fields as Field[]
    }
  }

  const groupField: GroupField = {
    name: 'comgate',
    type: 'group',
    admin: {
      condition: (data) => data?.paymentMethod === 'comgate',
      ...(groupOverrides?.admin || {}),
    },
    fields: finalFields,
  }

  return {
    name: 'comgate',
    label,
    initiatePayment,
    confirmOrder,
    group: groupField,
  }
}
