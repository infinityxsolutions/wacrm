import Link from 'next/link'
import type { ReactNode } from 'react'
import { COMPANY } from '@/lib/legal/company'

const NAV = [
  { href: '/pricing', label: 'Pricing' },
  { href: '/contact', label: 'Contact' },
]

const LEGAL = [
  { href: '/privacy', label: 'Privacy Policy' },
  { href: '/terms', label: 'Terms & Conditions' },
  { href: '/refund-policy', label: 'Refund & Cancellation' },
  { href: '/contact', label: 'Contact us' },
]

/** Header + footer for the public marketing and legal pages. */
export function PublicShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="border-b">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-4">
          <Link href="/" className="text-lg font-semibold">
            {COMPANY.product}
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className="text-muted-foreground hover:text-foreground">
                {n.label}
              </Link>
            ))}
            <Link href="/login" className="text-muted-foreground hover:text-foreground">
              Log in
            </Link>
            <Link href="/signup" className="rounded-md bg-primary px-3 py-1.5 text-primary-foreground">
              Start free trial
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10">{children}</main>
      <footer className="border-t">
        <div className="mx-auto grid max-w-5xl gap-6 px-4 py-8 text-sm md:grid-cols-2">
          <div className="space-y-1 text-muted-foreground">
            <p className="font-medium text-foreground">
              {COMPANY.product} by {COMPANY.legalName}
            </p>
            <p>{COMPANY.address}</p>
            <p>
              <a href={`mailto:${COMPANY.email}`} className="hover:text-foreground">
                {COMPANY.email}
              </a>
              {' · '}
              <a href={`tel:${COMPANY.phoneHref}`} className="hover:text-foreground">
                {COMPANY.phone}
              </a>
            </p>
          </div>
          <ul className="flex flex-wrap gap-x-6 gap-y-2 md:justify-end">
            {LEGAL.map((l) => (
              <li key={l.label}>
                <Link href={l.href} className="text-muted-foreground hover:text-foreground">
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </footer>
    </div>
  )
}

/** Consistent heading + last-updated line for a legal page. */
export function LegalPage({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <article className="mx-auto max-w-3xl space-y-6 text-sm leading-6 [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-semibold [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-6">
      <header>
        <h1 className="text-3xl font-semibold">{title}</h1>
        <p className="mt-1 text-muted-foreground">Last updated: {updated}</p>
      </header>
      {children}
    </article>
  )
}
