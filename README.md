# payload-comgate-adapter

[![npm version](https://img.shields.io/npm/v/payload-comgate-adapter.svg)](https://www.npmjs.com/package/payload-comgate-adapter)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Comgate payment gateway adapter for [PayloadCMS](https://payloadcms.com/) ecommerce plugin.

[Comgate](https://www.comgate.cz/) is a Czech payment gateway supporting credit cards, bank transfers, Google Pay, Apple Pay, and other payment methods popular in Czech Republic and Slovakia.

## Features

- Full integration with `@payloadcms/plugin-ecommerce`
- Support for all Comgate payment methods
- Built-in mock mode for development
- TypeScript support with full type safety
- Test mode support for sandbox payments

## Installation

```bash
npm install payload-comgate-adapter
# or
pnpm add payload-comgate-adapter
# or
yarn add payload-comgate-adapter
```

## Requirements

- PayloadCMS 3.x
- `@payloadcms/plugin-ecommerce` ^3.60.0

## Quick Start

### 1. Server Configuration

Add the Comgate adapter to your Payload ecommerce plugin configuration:

```typescript
// payload.config.ts
import { buildConfig } from 'payload'
import { ecommercePlugin } from '@payloadcms/plugin-ecommerce'
import { comgateAdapter } from 'payload-comgate-adapter'

export default buildConfig({
  // ... other config
  plugins: [
    ecommercePlugin({
      payments: {
        paymentMethods: [
          comgateAdapter({
            merchantId: process.env.COMGATE_MERCHANT_ID!,
            secret: process.env.COMGATE_SECRET!,
            testMode: process.env.NODE_ENV !== 'production',
            country: 'SK', // or 'CZ'
            lang: 'sk',    // or 'cs', 'en'
          }),
        ],
      },
      // ... other ecommerce config
    }),
  ],
})
```

### 2. Client Configuration

Add the client adapter to your EcommerceProvider:

```typescript
// providers.tsx
import { EcommerceProvider } from '@payloadcms/plugin-ecommerce/client/react'
import { comgateAdapterClient } from 'payload-comgate-adapter/client'

export function Providers({ children }) {
  return (
    <EcommerceProvider
      paymentMethods={[
        comgateAdapterClient({ label: 'Platba kartou (Comgate)' }),
      ]}
    >
      {children}
    </EcommerceProvider>
  )
}
```

### 3. Environment Variables

```env
COMGATE_MERCHANT_ID=your-merchant-id
COMGATE_SECRET=your-secret
```

## Configuration Options

### Server Adapter (`comgateAdapter`)

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `merchantId` | `string` | **required** | Comgate merchant ID (6-digit number) |
| `secret` | `string` | **required** | Comgate API secret |
| `testMode` | `boolean` | `false` | Enable Comgate test/sandbox mode |
| `country` | `string` | `'CZ'` | Default country code (ISO 3166-1 alpha-2) |
| `lang` | `string` | `'cs'` | Payment page language (`cs`, `sk`, `en`, `pl`, `hu`, `ro`, `de`, `fr`, `es`, `it`) |
| `preauth` | `boolean` | `false` | Enable preauthorization mode |
| `method` | `string` | `'ALL'` | Payment method filter |
| `label` | `string` | `'Comgate'` | Display label |
| `serverUrl` | `string` | auto | Base URL for return redirects |

### Client Adapter (`comgateAdapterClient`)

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `label` | `string` | `'Comgate'` | Display label for payment method |

## Mock Mode (Development)

For development without real Comgate credentials, use mock mode by setting:

```typescript
comgateAdapter({
  merchantId: 'test-merchant-id',
  secret: 'test-secret',
  // ... other options
})
```

In mock mode:
- No real API calls are made
- Payments are automatically "successful"
- Transaction IDs start with `MOCK-`
- Perfect for local development and testing

## Payment Flow

1. **Customer initiates checkout** → `initiatePayment()` is called
2. **Transaction created** in database with status `pending`
3. **Comgate API called** → returns redirect URL
4. **Customer redirected** to Comgate payment page
5. **Customer completes payment** on Comgate
6. **Customer returns** to `/checkout/confirm-order?transId=...`
7. **`confirmOrder()` called** → verifies payment status
8. **Order created** if payment successful
9. **Cart marked as purchased**, transaction updated to `succeeded`

## Transaction Fields

The adapter adds a `comgate` group field to transactions with:

- `transId` - Comgate transaction ID
- `status` - Payment status (PAID, PENDING, etc.)
- `fee` - Transaction fee charged by Comgate
- `payerName` - Payer name from payment method
- `payerAcc` - Payer account/card info

## Webhook Support (STATUS URL)

Comgate supports async payment status notifications via STATUS URL. Configure the webhook URL in your Comgate portal:

```
https://yourdomain.com/api/payments/comgate/webhook
```

> Note: Webhook endpoint implementation coming soon.

## Getting Comgate Credentials

1. Register at [Comgate Portal](https://portal.comgate.cz)
2. Complete merchant verification
3. Get your Merchant ID (6-digit number) and API Secret
4. Configure webhook/return URLs

## TypeScript

Full TypeScript support with exported types:

```typescript
import type {
  ComgateAdapterArgs,
  ComgateAdapterClientArgs,
  ComgateCreateResponse,
  ComgateStatusResponse,
  ComgateWebhookPayload,
} from 'payload-comgate-adapter'
```

## Advanced Usage

### Custom Transaction Fields

Override the default Comgate group fields:

```typescript
comgateAdapter({
  merchantId: '...',
  secret: '...',
  groupOverrides: {
    fields: ({ defaultFields }) => [
      ...defaultFields,
      {
        name: 'customField',
        type: 'text',
        label: 'Custom Field',
      },
    ],
  },
})
```

### Direct API Access

For advanced scenarios, you can use the API utilities directly:

```typescript
import {
  createPayment,
  getPaymentStatus,
  createAuthHeader,
} from 'payload-comgate-adapter'
```

## Contributing

Contributions are welcome! Please read our contributing guidelines.

## License

MIT © [blaze IT s.r.o.](https://www.blazeit.sk/)

## Links

- [Comgate API Documentation](https://apidoc.comgate.cz/en/)
- [Comgate Help](https://help.comgate.cz/docs/en/)
- [PayloadCMS Ecommerce Plugin](https://payloadcms.com/docs/ecommerce/overview)
