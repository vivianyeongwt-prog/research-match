# Creator affiliate operations

ResearchMatch has one active creator arrangement with **The Oxford PhD (Hira)**.

- Audience code: `OXFORDPHD777`
- Audience discount: 20% off the first payment
- Creator commission: 30% of attributed payments, including renewals
- Discount delivery: automatic in Stripe Checkout
- Attribution and commission ledger: automatic in Supabase
- Creator payout: manual outside the application

## Current snapshot

Verified 2026-08-04:

- One referred subscription was recorded.
- Its $2.10 commission was voided after the underlying payments were refunded.
- Pending creator balance: **$0.00**.
- Paid commission balance: **$0.00**.
- Payout records: **0**.

Run this any time for a fresh, read-only balance:

```bash
npm run affiliate:earnings -- --code OXFORDPHD777
```

The command does not move money or mark anything paid.

## What each Supabase table means

| Table | Purpose |
| --- | --- |
| `affiliates` | One creator record: contact/payout email, code, rate, status, and linked Stripe promotion code |
| `referrals` | The first-touch relationship between a creator and a Stripe customer/subscription |
| `commissions` | The actual ledger: one amount per attributed payment with `pending`, `paid`, or `void` status |
| `payouts` | Manual audit record after money is sent to a creator |
| `affiliate_payment_reversals` | Idempotency ledger that prevents a refund/dispute adjustment from being applied twice |

Only `commissions` with status `pending` are currently owed. Do not add the
tables together; they describe different parts of the same flow.

## Five-minute payout routine

1. Run the earnings command above.
2. If pending is $0, do nothing.
3. If pending is greater than $0, send that amount using the payout method agreed
   with Hira and retain the payment reference/receipt.
4. Only after the external payment succeeds, mark the matching pending commission
   rows `paid` and add one `payouts` record with the amount, currency, provider,
   external reference, and covered dates.
5. Run the earnings command again and confirm pending returns to $0.

Payout execution is intentionally not automated: Stripe tracks customer revenue,
but the creator's bank/PayPal destination is not connected. During the handoff,
the seller should demonstrate the reporting command and one dry walkthrough of
the Supabase bookkeeping. Never mark a commission paid before money is actually
sent.

## Stripe migration requirements

The creator promotion code and its Stripe IDs belong to the old Stripe account.
In the buyer's Stripe account:

1. Recreate a 20%-off, first-payment-only coupon.
2. Recreate the public code `OXFORDPHD777`.
3. Update `affiliates.stripe_promotion_code_id` to the new promotion-code ID.
4. Map the referred customer's old/new IDs in `referrals`.
5. If that subscription is migrated, update `referrals.stripe_subscription_id`
   to the new subscription ID so future renewal commissions remain attributed.
6. Make a test-mode creator checkout and verify one commission is created once,
   then verify a full refund changes it to `void` rather than duplicating it.

## Warm introduction

Ask Hira before sharing her contact details outside the transferred operational
record, then introduce both sides in one email. Suggested note:

> Hey Hira! Quick heads-up: I'm transferring ResearchMatch to a new owner. Your
> 20% audience code and 30% commission arrangement are part of the handoff, and
> the current balance is $0. I'd love to introduce you both so payouts and future
> coordination stay easy. Is that okay with you?

After she agrees, send a joint introduction and have the buyer confirm the payout
method directly with her.
