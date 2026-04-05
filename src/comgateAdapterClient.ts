import type { PaymentAdapterClient } from '@payloadcms/plugin-ecommerce/types'
import type { ComgateAdapterClientArgs } from './types'

/**
 * Client-side Comgate adapter for PayloadCMS ecommerce plugin
 *
 * @example
 * ```typescript
 * import { comgateAdapterClient } from 'payload-comgate-adapter/client'
 *
 * <EcommerceProvider
 *   paymentMethods={[
 *     comgateAdapterClient({ label: 'Platba kartou' }),
 *   ]}
 * >
 * ```
 */
export const comgateAdapterClient = (config?: ComgateAdapterClientArgs): PaymentAdapterClient => {
  const { label = 'Comgate' } = config || {}

  return {
    name: 'comgate',
    label,
    initiatePayment: true,
    confirmOrder: true,
  }
}
