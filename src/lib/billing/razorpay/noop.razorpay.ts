import { BillingNotConfiguredError, type RazorpayClient } from './razorpay.types'

/** Used when no Razorpay keys are set: every call fails clearly, nothing is sent anywhere. */
export class NoopRazorpay implements RazorpayClient {
  readonly enabled = false
  readonly testMode = false
  async createPlan(): Promise<never> {
    throw new BillingNotConfiguredError()
  }
  async createSubscription(): Promise<never> {
    throw new BillingNotConfiguredError()
  }
  async cancelSubscription(): Promise<never> {
    throw new BillingNotConfiguredError()
  }
}
