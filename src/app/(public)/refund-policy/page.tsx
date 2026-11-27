import type { Metadata } from 'next'
import { LegalPage } from '@/components/public/public-shell'
import { COMPANY } from '@/lib/legal/company'

export const metadata: Metadata = {
  title: `Refund & Cancellation Policy | ${COMPANY.product}`,
  description: 'How cancellations and refunds work.',
}

export default function RefundPolicyPage() {
  return (
    <LegalPage title="Refund & Cancellation Policy" updated={COMPANY.lastUpdated}>
      <p>This policy explains how to cancel {COMPANY.product} and when we refund payments.</p>

      <h2>Free trial</h2>
      <p>The 14-day trial is free and needs no payment, so there is nothing to refund.</p>

      <h2>Cancelling</h2>
      <ul>
        <li>You can stop renewal at any time in Settings, Plan & billing, using Cancel renewal.</li>
        <li>After you cancel, your plan stays active until the end of the period you already paid for. We then stop charging you.</li>
        <li>Cancelling does not delete your data. You can ask us to delete it by writing to {COMPANY.email}.</li>
      </ul>

      <h2>Monthly plans</h2>
      <p>Monthly payments are not refundable once the month has started. You will not be charged again after you cancel.</p>

      <h2>Yearly plans</h2>
      <p>
        If you ask within 7 days of your first yearly payment and you have not found the service suitable, we will refund the
        yearly payment in full, less any done-for-you setup or support services already delivered. After 7 days, yearly payments
        are not refundable, and cancelling stops renewal at the end of the paid year.
      </p>

      <h2>Mistakes and duplicate charges</h2>
      <p>
        If you were charged twice, charged the wrong amount, or charged after a cancellation took effect, tell us and we will
        refund the incorrect amount in full.
      </p>

      <h2>Paid setup and support sessions</h2>
      <p>One-time setup and support sessions are not refundable once delivered. If we have not started the work, we will refund the fee.</p>

      <h2>How refunds are paid</h2>
      <p>
        Approved refunds go back to the original payment method through Razorpay. They usually reach your account within 5 to 7
        working days, depending on your bank or card issuer.
      </p>

      <h2>How to ask</h2>
      <p>
        Email {COMPANY.email} from your account email with your business name and the payment date, or call {COMPANY.phone}. We
        reply within 2 working days.
      </p>
    </LegalPage>
  )
}
