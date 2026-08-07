# ResearchMatch buyer quick start

You are receiving the live business, not an empty code template. The existing
Supabase project preserves the users and database, the existing Vercel project
preserves the live deployment and domains, and Stripe's supported two-step
process copies customers' payment methods and recreates the recurring
subscriptions in the buyer account.

You do **not** need to implement the application or search through the code for
variable names.

> **Current handoff:** Read [DELIVERY-STATUS.md](./DELIVERY-STATUS.md) first.
> The Supabase and Stripe migration work recorded there is already complete and
> must not be repeated.

## 1. Receive the five assets

1. Accept the GitHub repository transfer.
2. Receive the existing Supabase project in your Supabase organization.
3. Accept the ResearchMatch-only customer copy in Stripe and complete the
   subscription migration with the seller.
4. Receive the existing Vercel project in your Vercel team.
5. Accept `researchmatch.site` in your Namecheap account.

Supabase's native project transfer carries Auth users, tables, functions, and
policies. Vercel's native project transfer carries deployments, domains,
configuration, and environment variables. Do not rebuild either one from an
empty account.

Before the Vercel transfer, the seller must replace or remove every seller-owned
API key in that project. Do not accept personal Stripe, AI-provider, analytics,
banking, tax, or identity credentials as part of the sale.

## 2. Open the private setup page

Install Node.js 22 or newer, then open Terminal in the transferred repository:

```bash
npm ci
npm run buyer:setup
```

The page opens only on your computer. Paste your values into the guided sections
and select **Save & verify**. Existing secret values are never loaded into the
browser. Blank fields keep their current value, and any previous `.env.local`
gets a private backup before it is replaced.

The page deliberately asks once for paired settings. For example, entering the
weekly Stripe price configures both the browser and server variable, so they
cannot accidentally drift apart.

You do not have to create the three Stripe prices, coupons, Oxford promotion
code, or webhook by hand. On the first pass, paste the buyer Stripe account ID,
publishable key, and secret key, save them, and leave the price fields blank.
The account ID is checked against the secret key before anything can be created,
which prevents an accidental change to the seller's unrelated Stripe account.
Then run:

```bash
npm run buyer:stripe:plan
npm run buyer:stripe:apply
```

The plan is read-only. Apply creates only deterministic ResearchMatch products,
prices, coupons, the `OXFORDPHD777` promotion code, and the webhook; it does not
charge, copy, cancel, or edit a customer or subscription. It also writes the new
IDs privately and relinks the transferred Oxford affiliate row. Reopen
`npm run buyer:setup` afterward and the Stripe section should be configured.

## 3. Update the transferred Vercel project

Link this checkout to the Vercel project you now own:

```bash
npx vercel link
npm run buyer:vercel:plan
```

The plan prints variable **names only**. When the project and list look right:

```bash
npm run buyer:vercel:apply
```

That command sends values to Vercel through standard input, never command-line
arguments, and never prints them. It updates Production but does not deploy. Make
one fresh production deployment from Vercel, then run:

```bash
npm run handoff:check:production
```

## 4. Finish Stripe together

Stripe is the one part that cannot be reduced to API keys. The seller's source
account contains unrelated InverseEnergy data, so ResearchMatch customers must
be selected rather than copying the entire account.

The seller runs this read-only command with the source account still connected:

```bash
npm run handoff:stripe:export
```

It creates a gitignored private folder containing only ResearchMatch customer,
subscription, price, and user IDs—no names, emails, card data, or API keys. The
customer IDs are used for Stripe's partial customer copy. The subscription file
is a planning inventory; download Stripe's current Billing Migration Toolkit
template in the buyer account and validate the final destination CSV there.

Do not cancel source subscriptions merely because the customer copy finished.
Stripe's customer copy does not copy subscriptions, prices, coupons, invoices,
or webhooks. Complete and verify the Billing migration, update the live webhook,
and only then perform the coordinated cutover.

Current official instructions:

- [Stripe customer/payment-data copy](https://docs.stripe.com/get-started/data-migrations/pan-copy-self-serve?copy-method=partial-csv-upload)
- [Stripe Billing migration toolkit](https://docs.stripe.com/billing/subscriptions/import-subscriptions-toolkit)
- [Supabase project transfer](https://supabase.com/docs/guides/platform/project-transfer)
- [Vercel project transfer](https://vercel.com/docs/projects/transferring-projects)

## 5. Final acceptance

After the fresh deployment, use [the full transfer checklist](../TRANSFER.md) to
test sign-in, search, all three checkout plans, the billing portal, email tools,
refund/webhook handling, the affiliate ledger, mobile navigation, and the live
domain. The inspection period should start only when the included assets are in
your control and the production check is passing.
