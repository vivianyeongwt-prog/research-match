# ResearchMatch handoff inventory

This is the plain-English list both sides should confirm in the Escrow message
thread before delivery. It prevents "I thought that was included" confusion; it
does not replace Escrow's transaction terms.

## Included

- `researchmatch.site` and its current DNS configuration.
- The ResearchMatch GitHub repository, source code, public assets, migrations,
  scripts, tests, and complete Git history.
- The production Supabase project, including Auth users, public-schema records,
  database functions, RLS policies, and operational affiliate records.
- The production Vercel project, deployments, project configuration, Web
  Analytics, Speed Insights, domain aliases, and buyer-controlled environment
  configuration.
- ResearchMatch Stripe products/prices/coupons, ResearchMatch customer/payment
  data, and subscriptions through Stripe's supported migration process.
- Existing public site copy, blog content, generated SEO content, brand marks,
  and product documentation in the repository.
- The active The Oxford PhD creator arrangement and its operational ledger.
- A reasonable handoff walkthrough and the acceptance evidence agreed in the
  Escrow transaction.

## Explicitly not included

- Seller passwords, recovery codes, personal email inboxes, personal devices,
  bank accounts, tax/KYC identity, or payment-account login credentials.
- The seller's entire InverseEnergy Stripe account, account balance, unrelated
  products, or unrelated customers.
- Seller-owned Anthropic, Serper, PostHog, or other API accounts/credits;
  those are replaced with buyer-owned accounts.
- A right to impersonate the seller or imply a continuing personal endorsement.
  The source currently contains historical founder/byline references to "Jace";
  the buyer should agree whether to retain them as historical attribution or
  replace them.
- Future revenue, traffic, retention, rankings, model availability, or customer
  behavior guarantees.
- An unrestricted marketing email list. Supabase/Auth records are transferred as
  operational customer/account data needed to run the product.

## Obligations and settings to confirm in writing

- Purchase price and currency: **US$4,250**.
- Escrow fee allocation shown in the transaction.
- Seven-day inspection trigger and acceptance tests.
- Who is responsible for pre-closing refunds, disputes, taxes, Stripe balances,
  domain renewal, and creator commissions.
- The buyer's support/admin email and the seller's post-transfer support window.
- That the buyer accepts the disclosed 20% creator discount and 30% creator
  commission on attributed payments, including renewals.

## Delivery evidence

At delivery, save a private copy of:

- Escrow's secured-funds status.
- The clean `main` commit hash and GitHub transfer confirmation.
- Secret-free output from `npm run handoff:check:production`.
- Supabase transfer confirmation and a dated aggregate-count snapshot.
- Stripe migration/copy confirmation, old-to-new ID mapping, subscription counts,
  and webhook test result.
- Vercel transfer and successful deployment result.
- Namecheap ownership confirmation and DNS checks.
- Buyer acceptance or the end of the inspection period.
