# Research Match

Research Match is a Next.js application that helps students find relevant professors, understand recent papers, evaluate public research activity, locate public contact information, and improve outreach drafts.

## Local setup

Requirements: Node.js 22 LTS, npm, a Supabase project, and credentials for the providers listed in `.env.example`.

```bash
npm ci
cp .env.example .env.local
npm run check
npm run dev
```

For a brand-new Supabase project with no production data, apply
`migrations/00000000_core_schema.sql` first, then the remaining migrations in
filename order. Do not use that greenfield sequence before importing an existing
project backup; restore the source schema and data first, as described in
`TRANSFER.md`. `migrations/20260720_sale_readiness.sql` contains the durable API
usage ledger and atomic Buddy Pass reward used by the current server routes.
`migrations/20260803205117_referral_system_hardening.sql` is also required: it
locks down the reward RPCs, prevents duplicate referral counts, and adds atomic
refund/dispute reversals. Apply the immediately following
`20260803210704_referral_reversal_lock_order.sql` as well.

## Checks

```bash
npm run lint
npm run typecheck
npm run build
npm audit --omit=dev
```

The detailed operational and ownership checklist is in [TRANSFER.md](./TRANSFER.md).

## Architecture

- Next.js App Router hosts the public site, account workspace, and server API routes.
- Supabase provides authentication and PostgreSQL data storage.
- Stripe provides checkout, subscriptions, the billing portal, refunds, and webhook events.
- OpenAlex and ORCID provide public research metadata.
- Groq and Anthropic power AI-assisted search expansion, summaries, and email tools.
- Serper supports public faculty-page discovery for the paid email finder.

### Backend layout

- `src/app/api/**/route.ts` contains thin HTTP handlers and request-specific validation.
- `src/lib/server-access.ts` owns authenticated Supabase access, quotas, and rate limits.
- `src/lib/stripe-server.ts` owns validated, lazy Stripe client configuration.
- `src/lib/stripe-access.ts` owns plan provisioning, renewal, downgrade, and revocation.
- `src/lib/stripe-affiliates.ts` owns affiliate attribution, commissions, and reversals.
- `src/lib/stripe-webhook.ts` normalizes Stripe event references across API versions.
- `src/lib/stripe-plans.ts` is the single fail-closed mapping from Stripe prices to plans.
- `migrations/` is the reproducible database contract used by those server modules.

### Frontend layout

- `src/app/app/page.tsx` coordinates search, access, and result state for the member workspace.
- `src/components/ResearchSearchForm.tsx` is the shared hero/results search interface.
- `src/components/ResearchAppNav.tsx`, `AccountModal.tsx`, `UpgradeModal.tsx`, and
  `EmailComposerModal.tsx` isolate the workspace's major presentation regions.
- `src/lib/research-match-domain.ts` owns OpenAlex author types, matching, ranking,
  deduplication, and formatting rules independently of React.
- `src/lib/browser-storage.ts` is the single contract for saved professors and
  free-allowance storage keys, including legacy migration behavior.

Never expose `SUPABASE_SERVICE_ROLE_KEY`, Stripe secret keys, webhook secrets, AI-provider keys, or `RATE_LIMIT_SECRET` to browser code.
