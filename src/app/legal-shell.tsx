import Link from "next/link";
import type { ReactNode } from "react";

export function LegalShell({ eyebrow, title, intro, children }: { eyebrow: string; title: string; intro: string; children: ReactNode }) {
  return (
    <main className="legal-page">
      <nav className="legal-nav" aria-label="Legal pages">
        <Link href="/" className="legal-brand">Research Match</Link>
        <div className="legal-nav-links">
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/contact">Contact</Link>
        </div>
      </nav>
      <article className="legal-card">
        <header className="legal-header">
          <p className="legal-eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          <p>{intro}</p>
          <time dateTime="2026-07-20">Effective July 20, 2026</time>
        </header>
        <div className="legal-copy">{children}</div>
      </article>
      <footer className="legal-footer"><Link href="/">← Back to Research Match</Link></footer>
    </main>
  );
}

export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return <section><h2>{title}</h2>{children}</section>;
}
