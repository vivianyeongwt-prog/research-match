# ResearchMatch service map

Read-only audit date: **2026-08-04**. Counts can increase while production is
live; use `npm run handoff:check:production` for the delivery snapshot.

| Service | Audited current state | Handoff method | Buyer action |
| --- | --- | --- | --- |
| GitHub | Public `jacekimmy/research-match`, default branch `main`; no Actions secret or variable names were found | Native repository transfer | Send GitHub username/org; accept within GitHub's deadline |
| Vercel | Project `research-match` on the active Hobby plan in the seller's personal team; Node 24; 16 encrypted environment-variable entries; apex and `www` domain routing | Native project transfer after secrets are replaced | Create target team, add seller temporarily, install buyer-owned keys |
| Supabase | Free organization plan; project `okvpopbghjvzpjbqgoqy`, healthy, Postgres 17, `us-west-2`; 1,126 Auth users and 1,126 profiles; 0 Storage buckets; 0 Edge Functions | Native project transfer to buyer organization | Create target org, add seller temporarily, confirm target plan/billing |
| Stripe | Account display name `InverseEnergy`; 45 subscriptions total: 17 active and 28 canceled; one enabled ResearchMatch webhook | Copy ResearchMatch payment data and migrate subscriptions into buyer's Stripe account | Activate live account, create the three plans, run Stripe migration, replace keys |
| Namecheap/DNS | `researchmatch.site`; expires 2027-04-06; Namecheap BasicDNS; apex points to Vercel and `www` uses Vercel CNAME; Namecheap forwarding MX records | Free Namecheap account push | Send username/email, accept ownership, verify DNS and forwarding |
| Groq | Required for core AI features and configured in production; the account's usage/billing tier was not available in this audit | New buyer-owned key | Create key and set it in Vercel |
| Anthropic | Preferred structured-output provider, but the audited production variable is blank; production currently falls back to Groq | New buyer-owned key | Create key and set it in Vercel if the buyer wants Claude |
| Serper | Optional enhancement for professor-email discovery; not found in the audited Vercel environment | New buyer-owned key or keep DuckDuckGo fallback | Optional |
| OpenAlex/ORCID | Public APIs; no transferable account | Change the polite-pool/contact email | Set `NEXT_PUBLIC_OPENALEX_MAILTO` to buyer-controlled email |
| NIH/NSF APIs | Public data used only by the optional funding updater script | No account transfer | No action unless running the updater |
| PostHog | Host/name exists in Vercel, but the audited project-token value is blank, so PostHog is currently off; autocapture and recordings are disabled in code | Transfer analytics project or create a new one | Prefer buyer-owned project; set the Vercel token if desired |
| Vercel Analytics/Speed Insights | Included in the deployed application | Moves with Vercel project | Confirm access after transfer |

## Current operating-cost evidence

- Verified fixed monthly hosting plan cost: **$0** before overages (Vercel Hobby
  plus a Supabase Free organization).
- Production currently uses Groq. The Anthropic value is blank, so Claude is not
  the current $5 expense; Groq's actual trailing usage bill still needs to be
  checked in its dashboard.
- Serper and PostHog are currently off. OpenAlex, ORCID, NIH, and NSF are public
  data sources used without a transferable paid account.
- Stripe charges transaction-related fees when revenue is collected, and the
  domain has an annual renewal rather than a monthly hosting fee.

So "very low operating costs" is supported, but **do not quote an exact $5/month
as verified**. Use the last Groq/provider invoices plus the annual domain renewal
to give the buyer an exact trailing figure.

## Stripe inventory that matters

- Current ResearchMatch offers: **$7/week**, **$29 every four months**, and
  **$59 lifetime**.
- Active recurring subscriptions: **7 weekly** and **10 semester**.
- Six of the 17 active subscriptions predate `metadata.userId`. The application
  can currently recover their user through Checkout history, but migration must
  preserve or repair that mapping before the old subscriptions are canceled.
- Webhook endpoint: `/api/webhooks/stripe`, enabled for Checkout completion,
  subscription updates/deletions, paid/failed invoices, refunds, and disputes.
- Coupons: 25% first-payment Buddy Pass and 20% first-payment creator discount.
- Do not copy the seller's Stripe login, bank account, balance, tax identity, or
  unrelated account configuration.

Official Stripe process: [copy payment data across Stripe accounts](https://docs.stripe.com/get-started/data-migrations/pan-copy-self-serve) and then use the [Billing migration toolkit](https://docs.stripe.com/billing/subscriptions/import-subscriptions-toolkit).

## Supabase inventory that matters

The hardened referral migrations are live, all public tables have RLS enabled,
and creator money tables are inaccessible to browser roles. Supabase's security
advisor currently flags leaked-password protection as disabled; the buyer should
enable it after ownership changes and then retest sign-up/recovery. Informational
"RLS enabled with no policy" notices on service-only operational tables are
intentional because only the service role may access them.

Official transfer process: [Supabase project transfers](https://supabase.com/docs/guides/platform/project-transfer). The seller must own the source organization and be at least a member of the buyer's target organization; active Supabase GitHub integrations, project-scoped roles, or log drains must be removed first if present.

## Vercel and domain notes

Vercel copies environment variables during a project transfer. That is useful
only after seller-owned secrets have been replaced with buyer-owned values.
Integrations and log history do not transfer. See [Vercel project transfers](https://vercel.com/docs/projects/transferring-projects).

The Namecheap account push is free and normally retains DNS records, but the
ownership change is final. See [Namecheap's account-to-account domain guide](https://www.namecheap.com/support/knowledgebase/article.aspx/1187/46/how-can-i-move-a-domain-from-one-namecheap-account-to-another/).
