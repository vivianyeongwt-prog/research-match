-- Add Research Buddy Pass referral tracking.
-- Run this in Supabase SQL Editor before deploying the Buddy Pass UI.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS referral_code text,
  ADD COLUMN IF NOT EXISTS buddy_pass_weeks_available integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS buddy_pass_weeks_earned integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS buddy_pass_weeks_used integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS buddy_pass_active_until timestamptz;

UPDATE public.profiles
SET referral_code = 'RM' || upper(substr(replace(id::text, '-', ''), 1, 14))
WHERE referral_code IS NULL OR referral_code = '';

CREATE UNIQUE INDEX IF NOT EXISTS profiles_referral_code_unique
  ON public.profiles (referral_code)
  WHERE referral_code IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.buddy_pass_referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  referred_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  referral_code text NOT NULL CHECK (referral_code ~ '^RM[A-Z0-9]{8,14}$'),
  checkout_session_id text NOT NULL UNIQUE,
  stripe_customer_id text,
  price_id text,
  status text NOT NULL DEFAULT 'rewarded'
    CHECK (status IN ('rewarded', 'void')),
  discount_percent integer NOT NULL DEFAULT 25 CHECK (discount_percent BETWEEN 1 AND 100),
  reward_weeks integer NOT NULL DEFAULT 1 CHECK (reward_weeks > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  rewarded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT buddy_pass_no_self_referral
    CHECK (referred_user_id IS NULL OR referrer_id <> referred_user_id)
);

CREATE INDEX IF NOT EXISTS buddy_pass_referrals_referrer_idx
  ON public.buddy_pass_referrals (referrer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS buddy_pass_referrals_referred_idx
  ON public.buddy_pass_referrals (referred_user_id);

CREATE UNIQUE INDEX IF NOT EXISTS buddy_pass_one_reward_per_user_unique
  ON public.buddy_pass_referrals (referred_user_id)
  WHERE referred_user_id IS NOT NULL AND status = 'rewarded';

ALTER TABLE public.buddy_pass_referrals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.buddy_pass_referrals FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.grant_buddy_pass_week(
  p_referrer_id uuid,
  p_weeks integer DEFAULT 1
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_weeks IS NULL OR p_weeks <= 0 THEN
    RAISE EXCEPTION 'reward weeks must be positive';
  END IF;

  UPDATE public.profiles
  SET
    buddy_pass_weeks_available = coalesce(buddy_pass_weeks_available, 0) + p_weeks,
    buddy_pass_weeks_earned = coalesce(buddy_pass_weeks_earned, 0) + p_weeks
  WHERE id = p_referrer_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'referrer profile not found';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.activate_buddy_pass_week(p_user_id uuid)
RETURNS TABLE(active_until timestamptz, weeks_available integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_active_until timestamptz;
  current_weeks_available integer;
BEGIN
  SELECT
    buddy_pass_active_until,
    buddy_pass_weeks_available
  INTO current_active_until, current_weeks_available
  FROM public.profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile not found';
  END IF;

  IF current_active_until IS NOT NULL AND current_active_until > now() THEN
    active_until := current_active_until;
    weeks_available := coalesce(current_weeks_available, 0);
    RETURN NEXT;
    RETURN;
  END IF;

  IF coalesce(current_weeks_available, 0) <= 0 THEN
    RAISE EXCEPTION 'no buddy pass weeks available';
  END IF;

  active_until := now() + interval '7 days';
  weeks_available := current_weeks_available - 1;

  UPDATE public.profiles
  SET
    buddy_pass_weeks_available = weeks_available,
    buddy_pass_weeks_used = coalesce(buddy_pass_weeks_used, 0) + 1,
    buddy_pass_active_until = active_until
  WHERE id = p_user_id;

  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.grant_buddy_pass_week(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.activate_buddy_pass_week(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_buddy_pass_week(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.activate_buddy_pass_week(uuid) TO service_role;
