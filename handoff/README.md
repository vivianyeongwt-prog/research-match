# ResearchMatch buyer handoff — start here

If you are the new owner, begin with
[BUYER-QUICKSTART.md](./BUYER-QUICKSTART.md). After the provider transfers,
`npm run buyer:setup` opens one private local page for every buyer-owned key and
runs the handoff checker automatically.

The live August 7 delivery record is in
[DELIVERY-STATUS.md](./DELIVERY-STATUS.md). Read it before running any Stripe or
Supabase migration command; those transfers have already been completed.

ResearchMatch is not sent as a ZIP full of passwords. The clean handoff is a
series of ownership transfers, followed by one verified production cutover. The
buyer receives the live product and its history; the seller keeps personal
logins, bank/tax information, and unrelated accounts private.

## What the buyer should create now

Create these under the buyer's own email and billing identity. Send only the
account name or ID requested below — never a password or recovery code.

| Service | Buyer sends to seller | Create/open |
| --- | --- | --- |
| GitHub | GitHub username or organization | [GitHub](https://github.com/signup) |
| Vercel | Target team name; invite the seller temporarily | [Vercel](https://vercel.com/signup) |
| Supabase | Target organization name; invite the seller temporarily | [Supabase](https://supabase.com/dashboard) |
| Stripe | Activated live account ID beginning with `acct_` | [Stripe](https://dashboard.stripe.com/register) |
| Namecheap | Namecheap username or account email | [Namecheap](https://www.namecheap.com/myaccount/signup/) |
| Anthropic | Nothing in chat; create a buyer-owned API key | [Anthropic keys](https://console.anthropic.com/settings/keys) |
| Serper | Optional buyer-owned API key | [Serper](https://serper.dev/) |
| PostHog | Target organization/project or a new buyer-owned project | [PostHog](https://us.posthog.com/) |

The buyer should also choose the support email, admin email, and payout method
they want to use after closing. If a buyer-owned key must be installed before a
transfer, share it through a password manager or expiring encrypted link — not
Discord, email, or a GitHub issue.

## What gets transferred

- The GitHub repository with its complete commit history.
- The existing Supabase project, including Auth users, database rows, RLS,
  functions, and configuration.
- The Vercel production project, deployments, domain attachment, analytics, and
  environment-variable names after buyer-owned secrets replace seller keys.
- `researchmatch.site` through a free Namecheap account-to-account ownership
  change, with its current DNS records.
- ResearchMatch products, customers, payment methods, and active subscriptions
  through Stripe's supported account-to-account migration process.
- Brand/source assets and the operational affiliate records listed in
  [ASSET-SCHEDULE.md](./ASSET-SCHEDULE.md).

The connected Stripe login itself is **not** handed over. It is identity,
banking, tax, and compliance scoped under the seller's InverseEnergy account.
Stripe provides a supported path to copy ResearchMatch payment data and migrate
the subscriptions into the buyer's Stripe account.

## Exact transfer sequence

### Before Escrow says the funds are secured

1. Buyer creates the accounts above and sends the account identifiers.
2. Buyer and seller confirm [ASSET-SCHEDULE.md](./ASSET-SCHEDULE.md) in writing.
3. Buyer invites seller to the target Vercel team and Supabase organization.
4. Start preparing the Stripe-to-Stripe migration. Do not cancel subscriptions,
   change production keys, or transfer ownership yet.
5. Seller can give a read-only walkthrough and share this repository's handoff
   documents. A payment screenshot is not the transfer trigger.

### After Escrow independently shows **funds secured**

1. Freeze deployments and billing changes for the cutover window.
2. Run `npm run handoff:check:production` and save its secret-free output.
3. Take the freshest available Supabase backup/dump and run
   `npm run handoff:stripe:export` for a dated ResearchMatch-only Stripe source
   inventory. Keep both private.
4. Transfer the GitHub repository to the buyer.
5. Transfer the existing Supabase project to the buyer's organization. This is
   safer than rebuilding Auth and production data in a new project.
6. Complete Stripe's payment-data copy and Billing migration. Preserve
   `metadata.userId`, map old to new customer/subscription IDs, recreate the
   three current prices and two coupons, and update the affiliate's Stripe IDs.
7. Replace or remove **every** seller-owned Vercel secret before the Vercel
   transfer. Install the buyer's Supabase, Stripe, Anthropic, Serper,
   PostHog, support, and admin settings; redeploy and rerun the production check.
8. Transfer the Vercel project to the buyer's team.
9. Push `researchmatch.site` to the buyer's Namecheap account and confirm both
   the website and email forwarding still work.
10. Introduce the buyer to The Oxford PhD/Hira and hand over the creator routine
    in [AFFILIATE.md](./AFFILIATE.md).

The seven-day inspection should begin only after the included assets are in the
buyer's control and the production check can be run. Stripe migration is the
longest step, so schedule it before declaring delivery complete.

Do not transfer Vercel while a readable seller-owned API key remains in its
environment. The buyer can enter their keys on the seller's computer during the
cutover, share them through an expiring encrypted link, or receive a project
whose seller-owned keys were removed and immediately run the buyer setup/sync.

## First local run for the buyer

```bash
git clone <the-transferred-repository-url>
cd research-match
npm ci
npm run buyer:setup
```

The setup page writes `.env.local`, configures paired values such as public and
server Stripe price IDs together, and runs the checker without printing secret
values. If the buyer Stripe account is empty, paste its two API keys, save, and
let the repository create the plans, coupons, Oxford code, webhook, and affiliate
link:

```bash
npm run buyer:stripe:plan
npm run buyer:stripe:apply
```

Neither command touches existing customers or subscriptions. After Vercel is
linked and the buyer owns production, preview the names and then apply the
configuration:

```bash
npx vercel link
npm run buyer:vercel:plan
npm run buyer:vercel:apply
```

After a fresh production deployment, run:

```bash
npm run handoff:check:production
```

Then work through the acceptance checklist in [TRANSFER.md](../TRANSFER.md).

## What not to send

Do not send `.env.local`, account passwords, recovery codes, full database
exports over chat, personal email credentials, Stripe bank/tax/KYC details, or a
copy of the seller's whole computer. Ownership transfers and buyer-owned keys
replace password sharing.
