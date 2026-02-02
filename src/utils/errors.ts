/**
 * Structured error for payment operations
 */
export class PaymentError extends Error {
  public readonly cause?: { code?: string }

  constructor(message: string, cause?: { code?: string }) {
    super(JSON.stringify({ message, cause }))
    this.name = 'PaymentError'
    this.cause = cause
  }

  /**
   * Get the error message as a plain string
   */
  get plainMessage(): string {
    try {
      const parsed = JSON.parse(this.message)
      return parsed.message || this.message
    } catch {
      return this.message
    }
  }
}
