import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'Real Estate AI — Listing Parser',
  description:
    'Fullstack demo: paste a WhatsApp listing broadcast, watch the AI pipeline parse, validate, and structure it.',
};

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="rounded-md px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900">
      {children}
    </Link>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="min-h-screen">
          <header className="border-b border-slate-200 bg-white">
            <nav className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
              <Link href="/" className="font-semibold tracking-tight text-slate-900">
                Real&nbsp;Estate&nbsp;AI <span className="font-normal text-slate-400">· parser</span>
              </Link>
              <div className="flex items-center gap-1">
                <NavLink href="/">Home</NavLink>
                <NavLink href="/parse">Playground</NavLink>
                <NavLink href="/listings">Listings</NavLink>
              </div>
            </nav>
          </header>
          <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
        </div>
      </body>
    </html>
  );
}
