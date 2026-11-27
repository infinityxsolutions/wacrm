import type { Metadata } from 'next'
import { LegalPage } from '@/components/public/public-shell'
import { COMPANY } from '@/lib/legal/company'

export const metadata: Metadata = {
  title: `Terms & Conditions | ${COMPANY.product}`,
  description: `The terms for using ${COMPANY.product}.`,
}

export default function TermsPage() {
  return (
    <LegalPage title="Terms & Conditions" updated={COMPANY.lastUpdated}>
      <p>
        These terms govern your use of {COMPANY.product}, operated by {COMPANY.legalName}, {COMPANY.address} (&ldquo;we&rdquo;, &ldquo;us&rdquo;). By
        creating an account or using the service you agree to them on behalf of yourself and the business you represent.
      </p>

      <h2>The service</h2>
      <p>
        {COMPANY.product} lets a business manage customer conversations on WhatsApp and email, use an AI assistant, and organise
        customers in pipelines. Features and limits depend on your plan. We may improve or change features over time.
      </p>

      <h2>Accounts</h2>
      <ul>
        <li>You must give accurate information and keep your sign-in details secure. You are responsible for activity in your account.</li>
        <li>The account owner decides who joins the team and what role they have.</li>
        <li>You must be able to enter a binding contract for your business.</li>
      </ul>

      <h2>Free trial, plans and payment</h2>
      <ul>
        <li>New accounts get a 14-day free trial. No payment is needed to start it.</li>
        <li>Paid plans renew automatically each month or year until cancelled. Prices are in Indian rupees and are shown on the pricing page. Applicable taxes such as GST are charged as required by law.</li>
        <li>Payments are processed by Razorpay. You can cancel renewal at any time in Settings, Plan & billing; access continues until the end of the period you paid for.</li>
        <li>If a plan lapses or a payment fails, your account may become read-only after a short grace period. We do not delete your data because of non-payment. Refunds are covered in our Refund & Cancellation Policy.</li>
        <li>We may change prices for future billing periods with reasonable notice. Plan limits apply as stated for your plan.</li>
      </ul>

      <h2>Your messages and responsibilities</h2>
      <ul>
        <li>You must follow the WhatsApp Business Terms and Messaging Policy, Meta&rsquo;s rules, and all applicable laws, including laws on marketing messages, spam and consent.</li>
        <li>Send marketing messages and emails only to people who have agreed to receive them, and honour opt-outs and unsubscribes promptly.</li>
        <li>You are responsible for the content you send, the contacts you upload, and for having the right to use that data.</li>
        <li>Review AI-generated replies and settings. AI output can be inaccurate, and you are responsible for what is sent from your account.</li>
        <li>Do not use the service for unlawful, deceptive, harassing or harmful activity, to send spam, or to attempt to breach the service or other customers&rsquo; data.</li>
      </ul>

      <h2>Third-party services</h2>
      <p>
        The service works with third parties such as Meta (WhatsApp), Razorpay, Brevo and AI model providers. Their availability
        and rules are outside our control, and Meta may charge you directly for WhatsApp messaging on your own account.
      </p>

      <h2>Your data</h2>
      <p>
        You keep ownership of your data. You give us permission to process it to provide the service, as described in our Privacy
        Policy. You can export or delete your data on request.
      </p>

      <h2>Suspension and ending</h2>
      <p>
        We may suspend or end accounts that breach these terms, put the service or others at risk, or are required to be
        suspended by law or by a provider such as Meta. You may stop using the service at any time.
      </p>

      <h2>Availability and liability</h2>
      <p>
        We aim to keep the service available but do not promise it will be uninterrupted or error-free. To the extent the law
        allows, the service is provided &ldquo;as is&rdquo;, and our total liability for any claim is limited to the fees you paid us in the
        three months before the claim arose. We are not liable for indirect or consequential losses, lost profits, or losses
        caused by third-party services.
      </p>

      <h2>Governing law</h2>
      <p>These terms are governed by the laws of India, and the courts at Hyderabad, Telangana have jurisdiction.</p>

      <h2>Changes and contact</h2>
      <p>
        We may update these terms and will notify account owners of material changes. Questions: {COMPANY.email}, {COMPANY.phone}.
      </p>
    </LegalPage>
  )
}
