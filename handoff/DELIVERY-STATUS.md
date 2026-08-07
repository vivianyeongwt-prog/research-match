# ResearchMatch delivery status

Verified **August 7, 2026**. This is the current execution record; the other
handoff documents remain the reusable recovery and operating instructions.

## Completed

- **GitHub:** the repository and history are in `vivianyeongwt-prog/research-match`.
- **Namecheap:** `researchmatch.site` was accepted by the buyer.
- **Supabase:** the live project was transferred natively. Its existing
  `okvpopbghjvzpjbqgoqy` project reference is intentionally unchanged; native
  ownership transfer preserves the project URL. The separate `kkwp…` project is
  not the production database and must not be installed in Vercel.
- **Supabase verification:** 1,136 Auth users match 1,136 profile rows; the
  affiliate configuration is intact; Storage has zero buckets.
- **Stripe catalog:** the three ResearchMatch prices, Buddy Pass coupon, Oxford
  coupon and `OXFORDPHD777` promotion code exist in the buyer account. The
  production webhook is enabled for every event handled by the application.
- **Stripe customer data:** all 17 active subscribers and their supported payment
  methods were copied and verified one-to-one in the buyer account.
- **Stripe subscriptions:** all 17 buyer-side schedules were validated against
  customer, payment method, price, quantity, user metadata, and source period end.
  Every matching source subscription is set to stop only at that same period end;
  no subscriber was ended early.
- **Affiliate balance:** The Oxford PhD arrangement remains active at 20% off the
  first payment and 30% commission. There are currently zero referral,
  commission, and payout records, so the amount owed is $0.
- **Code:** runtime AI calls use only the buyer-facing Anthropic configuration and
  pinned Claude Haiku. The old Groq dependency and fallback were removed.

## Still required before final delivery

1. Install a **buyer-owned Anthropic API key** in the private setup. Never put an
   API key in Discord, email, GitHub, or this repository.
2. Sync the verified buyer environment into the current Vercel project and make
   one fresh production deployment.
3. Run the production readiness check and exercise sign-in, one AI action,
   checkout creation, billing portal, and mobile navigation without completing a
   real purchase.
4. Generate the Vercel claim link. The buyer opens it while signed into Vercel,
   chooses their account, and confirms the transfer.
5. Confirm `researchmatch.site` still resolves to the claimed production project.

## Important Stripe timing note

The buyer account may show zero **active** subscriptions until the scheduled
start times arrive. That is expected: each buyer subscription begins at the exact
end of the subscriber's already-paid source period. Do not create replacements
manually and do not reactivate the source subscriptions.

## Final operating checks

After the Vercel claim, run:

```bash
npm ci
npm run check
npm run build
npm run handoff:check:production
npm run affiliate:earnings -- --code OXFORDPHD777
```

Secret values must remain in local or provider-managed environment storage. They
must never be committed to Git.
