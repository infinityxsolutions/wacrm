import type { Metadata } from 'next'
import { COMPANY } from '@/lib/legal/company'

export const metadata: Metadata = {
  title: `Contact us | ${COMPANY.product}`,
  description: `Contact ${COMPANY.legalName} about ${COMPANY.product}.`,
}

export default function ContactPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-3xl font-semibold">Contact us</h1>
      <p className="text-muted-foreground">
        Questions about plans, setup, billing or your account? We reply within 2 working days.
      </p>
      <dl className="space-y-4 rounded-lg border p-5 text-sm">
        <div>
          <dt className="font-medium">Business</dt>
          <dd className="text-muted-foreground">
            {COMPANY.legalName} (operating {COMPANY.product})
          </dd>
        </div>
        <div>
          <dt className="font-medium">Email</dt>
          <dd>
            <a className="underline" href={`mailto:${COMPANY.email}`}>
              {COMPANY.email}
            </a>
          </dd>
        </div>
        <div>
          <dt className="font-medium">Phone / WhatsApp</dt>
          <dd>
            <a className="underline" href={`tel:${COMPANY.phoneHref}`}>
              {COMPANY.phone}
            </a>
          </dd>
        </div>
        <div>
          <dt className="font-medium">Address</dt>
          <dd className="text-muted-foreground">{COMPANY.address}</dd>
        </div>
      </dl>
    </div>
  )
}
