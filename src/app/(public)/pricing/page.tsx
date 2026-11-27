import type { Metadata } from 'next'
import Link from 'next/link'
import { platformDb } from '@/lib/platform/admin'
import { COMPANY } from '@/lib/legal/company'

export const metadata: Metadata = {
  title: `Pricing | ${COMPANY.product}`,
  description: 'Simple monthly and yearly plans in Indian rupees, with a 14-day free trial.',
}

// Plans are edited in the Admin console; refresh the page at most every 5 minutes.
export const revalidate = 300

interface Plan {
  id: string
  name: string
  description: string | null
  price_inr_monthly: number
  price_inr_yearly: number | null
  max_members: number
  max_contacts: number
  max_broadcast_messages_monthly: number
  max_ai_replies_monthly: number
  max_emails_monthly: number
}

const inr = (n: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)
const num = (n: number) => n.toLocaleString('en-IN')

async function loadPlans(): Promise<Plan[] | null> {
  try {
    const { data, error } = await platformDb()
      .from('plans')
      .select(
        'id, name, description, price_inr_monthly, price_inr_yearly, max_members, max_contacts, max_broadcast_messages_monthly, max_ai_replies_monthly, max_emails_monthly',
      )
      .eq('is_public', true)
      .order('sort_order')
    if (error) return null
    return (data ?? []) as Plan[]
  } catch {
    return null
  }
}

export default async function PricingPage() {
  const plans = await loadPlans()
  return (
    <div className="space-y-8">
      <div className="space-y-2 text-center">
        <h1 className="text-3xl font-bold">Simple pricing</h1>
        <p className="text-muted-foreground">
          Every plan starts with a 14-day free trial. Pay monthly, or yearly and get two months free. Prices are in Indian
          rupees; applicable taxes such as GST are charged as required by law.
        </p>
      </div>

      {!plans || plans.length === 0 ? (
        <p className="text-center text-muted-foreground">
          Plan details are being updated. Please write to {COMPANY.email} for current pricing.
        </p>
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          {plans.map((p) => (
            <div key={p.id} className="flex flex-col rounded-lg border p-6">
              <h2 className="text-lg font-semibold">{p.name}</h2>
              {p.description && <p className="mt-1 text-sm text-muted-foreground">{p.description}</p>}
              <p className="mt-4 text-3xl font-bold">
                {inr(p.price_inr_monthly)}
                <span className="text-sm font-normal text-muted-foreground"> / month</span>
              </p>
              <p className="text-sm text-muted-foreground">
                or {inr(p.price_inr_yearly ?? p.price_inr_monthly * 10)} / year (two months free)
              </p>
              <ul className="mt-4 flex-1 space-y-1 text-sm">
                <li>{num(p.max_members)} team members</li>
                <li>{num(p.max_contacts)} contacts</li>
                <li>{num(p.max_broadcast_messages_monthly)} broadcast messages / month</li>
                <li>{num(p.max_ai_replies_monthly)} AI replies / month</li>
                <li>{num(p.max_emails_monthly)} emails / month</li>
                <li>Shared inbox, pipelines, automations, Autopilot setup</li>
              </ul>
              <Link href="/signup" className="mt-6 rounded-md bg-primary px-4 py-2 text-center text-sm font-medium text-primary-foreground">
                Start free trial
              </Link>
            </div>
          ))}
        </div>
      )}

      <div className="rounded-lg border p-5 text-sm">
        <h2 className="font-semibold">Want us to set it up for you?</h2>
        <p className="mt-1 text-muted-foreground">
          Setup help is free on yearly plans. On other plans, done-for-you setup and support sessions are available for an
          extra fee. Write to {COMPANY.email} for details. WhatsApp message charges from Meta, if any, are billed by Meta
          and are separate from these plans.
        </p>
      </div>
    </div>
  )
}
