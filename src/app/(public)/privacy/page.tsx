import type { Metadata } from 'next'
import { LegalPage } from '@/components/public/public-shell'
import { COMPANY } from '@/lib/legal/company'

export const metadata: Metadata = {
  title: `Privacy Policy | ${COMPANY.product}`,
  description: `How ${COMPANY.product} collects, uses and protects personal data.`,
}

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" updated={COMPANY.lastUpdated}>
      <p>
        {COMPANY.product} is a customer-messaging and CRM service operated by {COMPANY.legalName} (&ldquo;we&rdquo;, &ldquo;us&rdquo;), {COMPANY.address}.
        This policy explains what personal data we handle and why. If you have questions, write to{' '}
        <a className="underline" href={`mailto:${COMPANY.email}`}>
          {COMPANY.email}
        </a>
        .
      </p>

      <h2>Two kinds of people, two roles</h2>
      <ul>
        <li>
          <strong>Our customers (businesses and their team members).</strong> We are responsible for the account data you give us
          to sign up and pay.
        </li>
        <li>
          <strong>Your customers.</strong> When a business uses {COMPANY.product}, it decides what customer data to store and who to
          message. For that data the business is responsible and we process it on its behalf, following its instructions and this
          policy.
        </li>
      </ul>

      <h2>What we collect</h2>
      <ul>
        <li>Account details: name, email address, password (stored only as a secure hash by our authentication provider), role and business name.</li>
        <li>Business data you add: contacts (name, phone number, email, tags), conversations and messages, templates, notes, pipelines, knowledge-base documents and settings.</li>
        <li>Billing details: plan, billing period and payment history. Card, UPI and bank details are entered on Razorpay&rsquo;s secure page and are not stored by us.</li>
        <li>Usage and technical data: sign-in times, feature usage counts for plan limits, and error logs.</li>
        <li>Cookies: only the cookies needed to keep you signed in and remember your display settings. We do not use advertising cookies on the app.</li>
      </ul>

      <h2>How we use it</h2>
      <ul>
        <li>To provide the service: deliver and receive WhatsApp and email messages, show your inbox, run automations and the AI agent.</li>
        <li>To bill you, apply plan limits and prevent abuse.</li>
        <li>To support you and fix problems.</li>
        <li>To meet legal obligations.</li>
      </ul>
      <p>We do not sell personal data.</p>

      <h2>Service providers we rely on</h2>
      <p>We share data only as needed to run the service, with providers such as:</p>
      <ul>
        <li>Meta (WhatsApp Business Platform), to send and receive WhatsApp messages through the business&rsquo;s own number.</li>
        <li>Supabase, for our database and sign-in, and Railway, for hosting.</li>
        <li>Razorpay, for payments.</li>
        <li>Brevo, for sending email campaigns.</li>
        <li>An AI model provider (for example Anthropic), which receives the text of a conversation and the business&rsquo;s knowledge base only when the AI agent drafts or sends a reply.</li>
      </ul>
      <p>These providers process data under their own terms and security measures and may store it outside India.</p>

      <h2>AI features</h2>
      <p>
        The AI agent uses only the information a business provides to it and the conversation in question. Businesses control
        whether AI replies are on, and a person can take over any conversation. AI output can be wrong; businesses should review
        it before relying on it.
      </p>

      <h2>Email and unsubscribing</h2>
      <p>
        Every marketing email sent through {COMPANY.product} contains an unsubscribe link. When someone unsubscribes, bounces
        permanently or reports spam, they are excluded from future emails from that business.
      </p>

      <h2>How long we keep data</h2>
      <p>
        We keep business data while the account is active. When an account is deleted, or on a verified deletion request, we delete
        the data from our systems, except records we must keep by law (such as invoices) and routine backups, which expire on
        their normal cycle.
      </p>

      <h2>Security</h2>
      <p>
        Data is stored with access controls that separate each business&rsquo;s data from others, traffic is encrypted in transit, and
        sensitive keys are encrypted at rest. No system is perfectly secure; tell us at once if you suspect a problem.
      </p>

      <h2>Your rights</h2>
      <p>
        You may ask us to access, correct or delete your personal data, or to withdraw consent where we rely on it, as provided
        under applicable Indian law, including the Digital Personal Data Protection Act, 2023. If you are a customer of one of our
        business users, please contact that business first; we will help them respond. To exercise a right with us, email{' '}
        {COMPANY.email}. We may need to verify your identity.
      </p>

      <h2>Children</h2>
      <p>The service is for businesses and is not directed to children.</p>

      <h2>Changes</h2>
      <p>We may update this policy. The date above shows the latest version, and we will notify account owners of material changes.</p>

      <h2>Contact</h2>
      <p>
        {COMPANY.legalName}, {COMPANY.address}. Email {COMPANY.email}. Phone {COMPANY.phone}.
      </p>
    </LegalPage>
  )
}
