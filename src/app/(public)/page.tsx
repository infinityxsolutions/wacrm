import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { COMPANY } from '@/lib/legal/company'

export const metadata: Metadata = {
  title: `${COMPANY.product}: the WhatsApp CRM that sets itself up`,
  description:
    'Answer every WhatsApp enquiry in seconds with an AI agent, keep customers in one shared inbox, and set everything up from a single questionnaire.',
}

const FEATURES = [
  { title: 'One shared WhatsApp inbox', body: 'Your whole team answers customers from one place, with assignment, notes and notifications.' },
  { title: 'AI agent that knows your business', body: 'It replies using only the services, prices and policies you give it, and hands over to a person when it is unsure.' },
  { title: 'Autopilot setup', body: 'Fill in one questionnaire and GrowthXAi builds your AI instructions, knowledge base, quick replies, job pipeline, tags and WhatsApp templates.' },
  { title: 'Pipelines and follow-ups', body: 'See every enquiry and job in a visual pipeline, and keep customers informed with approved WhatsApp templates.' },
  { title: 'Broadcasts and email', body: 'Send offers and reminders to customers who agreed to hear from you, by WhatsApp and by email with a one-click unsubscribe.' },
  { title: 'Built for many businesses', body: 'Every business gets its own private account, team roles and plan limits.' },
]

export default async function HomePage() {
  // Signed-in users go straight to their workspace.
  const supabase = await createClient()
  const { data } = await supabase.auth.getUser()
  if (data.user) redirect('/dashboard')

  return (
    <div className="space-y-16">
      <section className="space-y-5 py-8 text-center">
        <h1 className="mx-auto max-w-3xl text-4xl font-bold tracking-tight md:text-5xl">
          The WhatsApp CRM that sets itself up
        </h1>
        <p className="mx-auto max-w-2xl text-lg text-muted-foreground">
          Answer every customer enquiry in seconds, keep every chat in one inbox, and turn more enquiries into bookings,
          without hiring anyone.
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <Link href="/signup" className="rounded-md bg-primary px-5 py-2.5 font-medium text-primary-foreground">
            Start your 14-day free trial
          </Link>
          <Link href="/pricing" className="rounded-md border px-5 py-2.5 font-medium">
            See pricing
          </Link>
        </div>
        <p className="text-sm text-muted-foreground">No card needed to start. Works with the official WhatsApp Business Platform.</p>
      </section>

      <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((f) => (
          <div key={f.title} className="rounded-lg border p-5">
            <h2 className="font-semibold">{f.title}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{f.body}</p>
          </div>
        ))}
      </section>

      <section className="rounded-lg border p-6 text-center">
        <h2 className="text-xl font-semibold">Ready to try it?</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Questions? Write to{' '}
          <a className="underline" href={`mailto:${COMPANY.email}`}>
            {COMPANY.email}
          </a>{' '}
          or call {COMPANY.phone}.
        </p>
      </section>
    </div>
  )
}
