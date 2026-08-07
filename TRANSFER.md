# Research Match transfer runbook

The buyer should begin with [`handoff/README.md`](./handoff/README.md). This file
is the technical appendix and canonical recovery/acceptance runbook.

The repository contains the application, public assets, reproducible database schema, and configuration contract. A buyer still needs ownership of, or replacement credentials for, every external service below.

## Required handoff inventory

1. Source repository and its complete Git history.
2. Supabase project, including Auth users, production rows, database settings, backups, and service credentials.
3. A supported migration of ResearchMatch customers/subscriptions into the buyer's Stripe account, plus products, prices, coupons, portal configuration, webhook endpoint, commissions, and payout records.
4. Vercel project, production environment variables, deployment history, domains, and DNS.
5. Buyer-owned Anthropic and optional Serper credentials, OpenAlex contact identity, and PostHog configuration, plus Vercel Analytics ownership.
6. Support/admin mailboxes, social accounts, brand assets, testimonials and their permissions, legal documents, and refund/support procedures.

Secrets must be transferred through a password manager or another encrypted channel, never committed to Git or sent in plain email.

## Choose the Supabase transfer path first

Do not apply the greenfield schema to an empty destination and then try to pour an
existing production backup into it. A manual transfer must preserve the source
schema and data types first. In particular, production `search_logs.id` values are
UUIDs; the core schema intentionally uses the same UUID contract.

### Recommended: transfer the existing Supabase project

1. Take a fresh Supabase backup and keep it unchanged as the rollback point.
2. Use Supabase's supported project-ownership transfer when the buyer can receive
   the whole project. This best preserves the database, Auth users, configuration,
   and the public `search_logs` history together.
3. Do not send the service-role key in chat. After transfer, rotate the project
   credentials and install the replacements directly in buyer-owned Vercel.
4. Re-verify Auth configuration, redirect URLs, custom SMTP, database settings,
   functions, extensions, RLS policies, and Storage after ownership changes.
5. A native transfer already includes the live hardening migrations; do not
   replay them. Run `npm run handoff:check:production` and verify the functions,
   tables, RLS, Auth/profile counts, and webhook before and after ownership moves.
6. Inventory every current and historical Stripe price ID before replaying webhooks.
   Put retired weekly, semester, and lifetime IDs in the corresponding comma-separated
   `STRIPE_LEGACY_*_PRICE_IDS` variables. Unknown prices intentionally grant nothing.

### Manual move to a different Supabase project

1. Create verified exports of database roles, schema, and data from the source,
   plus a separate supported export/transfer of Supabase Auth users.
2. Restore the source roles and schema to a private destination or staging project
   before restoring its table data. Do **not** run `00000000_core_schema.sql` first.
3. Restore Auth users using Supabase's supported administrative process, then
   restore public data and verify that every `profiles.id` still matches its
   corresponding Auth user ID.
4. Export and restore Storage objects and bucket policies separately. The
   2026-08-04 audit found no Storage buckets, but check again at transfer time.
5. Compare all table counts, primary-key types, foreign keys, functions, triggers,
   extensions, grants, RLS policies, and Auth settings before applying new changes.
6. Only after that restored copy passes comparison should missing upgrades be
   selected using the existing-project route in `migrations/README.md`. Never
   blanket-run the directory in filename order. Test the application against the
   restored copy before any production cutover.
7. `add_affiliate_program.sql` intentionally stops if it finds duplicate subscription
   referrals. Resolve those records only after manual accounting review in the restored
   staging copy; the migration never merges or deletes financial history automatically.

### Greenfield setup with no production data

1. Copy `.env.example` to `.env.local` and fill every required value.
2. Create a new Supabase project.
3. Apply the greenfield sequence in [`migrations/README.md`](./migrations/README.md).
   Do not run every SQL file alphabetically: several `add_*` files are legacy
   upgrade paths that the core schema supersedes, and the affiliate hardening
   migration requires the affiliate base tables first.
4. Run `npm run buyer:stripe:plan`, review the read-only plan, then run
   `npm run buyer:stripe:apply`. It creates the three prices, discounts, Oxford
   code, and `/api/webhooks/stripe` endpoint and writes every paired ID together.
5. Configure the canonical URL, support address, admin allowlist, OpenAlex contact
   email, and analytics ownership.
6. Run `npm ci`, `npm run check`, and `npm run build`.
7. Complete the acceptance checklist below before changing DNS.

## Read-only production inventory snapshot

The following was verified on 2026-08-04. It is a safety baseline, not a frozen
transfer count: new searches and users can arrive after the audit, so generate a
fresh source snapshot immediately before handoff with
`npm run handoff:check:production`.

| Public table | Rows |
| --- | ---: |
| `affiliates` | 1 |
| `affiliate_payment_reversals` | 0 |
| `anon_summary_uses` | 761 |
| `api_usage_buckets` | 1,305 |
| `buddy_pass_referrals` | 0 |
| `commissions` | 1 |
| `contact_messages` | 3 |
| `feedback` | 2 |
| `field_content` | 20 |
| `field_professors` | 240 |
| `payouts` | 0 |
| `pdf_downloads` | 0 |
| `processed_stripe_events` | 220 |
| `professors` | 0 |
| `profiles` | 1,126 |
| `promo_codes` | 1 |
| `referrals` | 1 |
| `search_logs` | 18,600 |
| `settings` | 1 |
| `waitlist` | 5 |

At the same snapshot, Supabase Auth contained 1,126 users and Storage contained
zero buckets. `search_logs` contained 3,949 authenticated searches and 14,651
anonymous searches, spanning 2026-04-05 through 2026-08-04. Its primary key was
UUID with a `gen_random_uuid()` default. After transfer, verify the new total and
date range against a fresh source count, then confirm `/api/stats` reports the same
total. Never use 18,600 as an expected final count if production remained active.

The 2026-08-04 audit confirmed that `api_usage_buckets`, `pdf_downloads`,
`professors`, `affiliate_payment_reversals`, the `plan_expires_at` profile column,
and the hardened referral/commission functions are live. Supabase migration
history lists the three 2026-08-03 hardening migrations. A manual restore or
cross-project migration must still be rehearsed in staging; a native Supabase
project transfer avoids reconstructing this state.

## Acceptance checklist

- Sign up, email confirmation, sign in, sign out, profile creation, and account recovery work.
- Free summary, free email-check, and free follow-up quotas persist across browsers and reject direct API bypasses.
- Weekly, semester, lifetime, Buddy Pass, promo, cancellation, renewal, failed payment, full refund, and duplicate webhook paths are exercised in Stripe test mode.
- Unknown or retired Stripe prices grant no plan until their exact IDs are explicitly mapped.
- A lifetime upgrade cancels any replaced subscription.
- Paid email finding and nearby-researcher endpoints reject anonymous and free callers.
- Privacy, terms, contact, feedback, and mobile/desktop navigation render without accessibility violations.
- Supabase RLS tests prove browser keys cannot change plans, usage, feedback votes, money tables, or operational logs directly.
- Production security headers are present and analytics/auth/network requests are not blocked by CSP.
- Database backup restore and rollback procedures have been rehearsed.

## Data that must be exported explicitly

Supabase Auth users are not ordinary public-table rows. Export them using the supported Supabase project transfer or administrative process. Export public-schema data, storage buckets, and database functions separately. Stripe customers and subscriptions are also outside this repository and must be handled through Stripe's supported account/business process.

Before the Stripe cutover, run `npm run handoff:stripe:export` with the source
account environment. The command is read-only and writes a gitignored private
inventory of mapped ResearchMatch subscriptions and customers without names,
emails, card data, or API keys. It is not itself a Billing Migration Toolkit
upload: use Stripe's current destination-account template and its required
future start date.

## Ownership cleanup

Before handoff, search for the old domain, personal email addresses, Stripe price IDs, Vercel project names, analytics project IDs, and creator/affiliate identities. Replace them with buyer-controlled values and verify the deployed HTML, generated PDF, metadata, sitemap, email links, and webhook configuration.
