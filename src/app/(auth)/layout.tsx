import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";

// Shared metadata for auth pages (login / signup / forgot-password).
// None of these should be indexed — they'd compete with the marketing
// landing in SERPs and offer nothing to a searcher who hasn't already
// signed up. Each page still gets its own <title> via its own
// metadata.title override below the route group layout.
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
    },
  },
};

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <p className="mx-auto max-w-md px-4 pb-6 text-center text-xs text-muted-foreground">
        <Link href="/privacy" className="underline">
          Privacy Policy
        </Link>
        {" · "}
        <Link href="/terms" className="underline">
          Terms
        </Link>
        {" · "}
        <Link href="/refund-policy" className="underline">
          Refunds
        </Link>
        {" · "}
        <Link href="/contact" className="underline">
          Contact
        </Link>
      </p>
    </>
  );
}
