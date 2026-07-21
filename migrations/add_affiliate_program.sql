-- Affiliate / creator revenue-share program.
--
-- The five tables below ALREADY EXIST in production (created earlier but never wired
-- into the app). This file documents them in source control and — the part that
-- actually matters — adds the indexes the Stripe webhook relies on to attribute sales
-- and to make commissions double-count-proof.
--
-- Safe + idempotent: CREATE TABLE/INDEX IF NOT EXISTS are no-ops on the existing
-- objects. Run it in the Supabase SQL Editor before deploying the wired webhook.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.affiliates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text,
  email text,
  payout_email text,
  code text,
  stripe_promotion_code_id text,
  commission_rate numeric NOT NULL DEFAULT 0.30,  -- 0.30 = 30%
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id uuid NOT NULL REFERENCES public.affiliates(id) ON DELETE CASCADE,
  stripe_customer_id text,
  stripe_subscription_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.commissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id uuid NOT NULL REFERENCES public.affiliates(id) ON DELETE CASCADE,
  referral_id uuid REFERENCES public.referrals(id) ON DELETE SET NULL,
  stripe_invoice_id text,  -- invoice id (subscriptions) or payment_intent/session id (one-time)
  amount_cents integer NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'usd',
  status text NOT NULL DEFAULT 'pending',  -- pending | paid | void
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id uuid NOT NULL REFERENCES public.affiliates(id) ON DELETE CASCADE,
  amount_cents integer NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'usd',
  status text NOT NULL DEFAULT 'pending',
  provider text,
  external_id text,
  period_start timestamptz,
  period_end timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Webhook idempotency ledger: one row per Stripe event id we've fully processed.
CREATE TABLE IF NOT EXISTS public.processed_stripe_events (
  id text PRIMARY KEY,
  status text NOT NULL DEFAULT 'completed',
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.processed_stripe_events
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'completed',
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'processed_stripe_events_status_check'
      AND conrelid = 'public.processed_stripe_events'::regclass
  ) THEN
    ALTER TABLE public.processed_stripe_events
      ADD CONSTRAINT processed_stripe_events_status_check
      CHECK (status IN ('processing', 'failed', 'completed'));
  END IF;
END $$;

-- Atomically claim an event. Completed events are immutable duplicates; failed
-- events can be retried immediately; abandoned processing claims can be recovered
-- after five minutes if a server died between the claim and completion update.
CREATE OR REPLACE FUNCTION public.claim_stripe_event(p_event_id text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_updated_at timestamptz;
BEGIN
  INSERT INTO public.processed_stripe_events (id, status, updated_at)
  VALUES (p_event_id, 'processing', now())
  ON CONFLICT (id) DO NOTHING;
  IF FOUND THEN RETURN 'claimed'; END IF;

  SELECT status, updated_at INTO v_status, v_updated_at
  FROM public.processed_stripe_events
  WHERE id = p_event_id
  FOR UPDATE;

  IF v_status = 'completed' THEN RETURN 'completed'; END IF;
  IF v_status = 'failed' OR v_updated_at < now() - interval '5 minutes' THEN
    UPDATE public.processed_stripe_events
      SET status = 'processing', last_error = null, updated_at = now()
      WHERE id = p_event_id;
    RETURN 'claimed';
  END IF;
  RETURN 'busy';
END;
$$;

REVOKE ALL ON FUNCTION public.claim_stripe_event(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_stripe_event(text) TO service_role;

-- One affiliate per code / per promo code; fast lookup from the webhook.
CREATE UNIQUE INDEX IF NOT EXISTS affiliates_code_unique
  ON public.affiliates (code) WHERE code IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS affiliates_promo_code_unique
  ON public.affiliates (stripe_promotion_code_id) WHERE stripe_promotion_code_id IS NOT NULL;

-- CRITICAL: never record two commissions for the same Stripe invoice / payment.
-- This is the hard backstop behind the webhook's check-before-insert.
CREATE UNIQUE INDEX IF NOT EXISTS commissions_invoice_unique
  ON public.commissions (stripe_invoice_id) WHERE stripe_invoice_id IS NOT NULL;

-- One referral per subscription. Non-partial so the webhook's idempotent
-- upsert(onConflict: stripe_subscription_id) works; NULLs (one-time payments) are
-- treated as distinct, so multiple NULL-subscription referrals are still allowed.
-- Never merge or delete financial rows automatically. If legacy duplicates exist,
-- stop the migration so an operator can review them in a backup/restored staging
-- copy and make an explicit accounting decision.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.referrals
    WHERE stripe_subscription_id IS NOT NULL
    GROUP BY stripe_subscription_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate referral subscriptions require manual review before creating referrals_subscription_unique';
  END IF;
END $$;

DROP INDEX IF EXISTS referrals_subscription_idx;
CREATE UNIQUE INDEX IF NOT EXISTS referrals_subscription_unique
  ON public.referrals (stripe_subscription_id);
CREATE INDEX IF NOT EXISTS referrals_affiliate_customer_idx
  ON public.referrals (affiliate_id, stripe_customer_id);
CREATE INDEX IF NOT EXISTS commissions_affiliate_status_idx
  ON public.commissions (affiliate_id, status);

-- Row Level Security: these tables hold money + payout data and must NEVER be
-- reachable from the browser (the anon / authenticated PostgREST roles). The only
-- writer/reader is the Stripe webhook + admin scripts, which use the service-role
-- key and bypass RLS entirely. Enabling RLS with NO policies means the public roles
-- get zero rows and zero writes, while the service role is unaffected.
--
-- Production already has RLS enabled on these; this documents and enforces it so a
-- fresh database can never come up with these tables world-readable. Idempotent.
ALTER TABLE public.affiliates              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referrals               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commissions             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payouts                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.processed_stripe_events ENABLE ROW LEVEL SECURITY;
