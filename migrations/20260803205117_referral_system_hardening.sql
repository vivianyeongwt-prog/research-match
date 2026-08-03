-- Referral-system hardening.
--
-- This migration is backward-compatible with the deployed checkout/webhook code.
-- It closes direct RPC access, prevents concurrent double rewards, makes affiliate
-- attribution idempotent for one-time checkouts, and validates reward metadata
-- against the owning profile before changing balances.

create extension if not exists pgcrypto;

update public.profiles
set referral_code = 'RM' || upper(substr(replace(id::text, '-', ''), 1, 14))
where referral_code is null or btrim(referral_code) = '';

create unique index if not exists profiles_referral_code_unique
  on public.profiles (referral_code)
  where referral_code is not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_referral_code_check'
  ) then
    alter table public.profiles
      add constraint profiles_referral_code_check
      check (referral_code is null or referral_code ~ '^RM[A-Z0-9]{8,14}$');
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_buddy_pass_weeks_available_check'
  ) then
    alter table public.profiles
      add constraint profiles_buddy_pass_weeks_available_check
      check (buddy_pass_weeks_available >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_buddy_pass_weeks_earned_check'
  ) then
    alter table public.profiles
      add constraint profiles_buddy_pass_weeks_earned_check
      check (buddy_pass_weeks_earned >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_buddy_pass_weeks_used_check'
  ) then
    alter table public.profiles
      add constraint profiles_buddy_pass_weeks_used_check
      check (buddy_pass_weeks_used >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_buddy_pass_balance_check'
  ) then
    alter table public.profiles
      add constraint profiles_buddy_pass_balance_check
      check (buddy_pass_weeks_available + buddy_pass_weeks_used = buddy_pass_weeks_earned);
  end if;
end
$$;

do $$
begin
  if exists (
    select 1 from public.buddy_pass_referrals
    where checkout_session_id is null or btrim(checkout_session_id) = ''
  ) then
    raise exception 'Buddy Pass rows without checkout session IDs require manual review';
  end if;

  alter table public.buddy_pass_referrals
    alter column checkout_session_id set not null;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.buddy_pass_referrals'::regclass
      and conname = 'buddy_pass_referrals_referral_code_check'
  ) then
    alter table public.buddy_pass_referrals
      add constraint buddy_pass_referrals_referral_code_check
      check (referral_code ~ '^RM[A-Z0-9]{8,14}$');
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.buddy_pass_referrals'::regclass
      and conname = 'buddy_pass_referrals_discount_percent_check'
  ) then
    alter table public.buddy_pass_referrals
      add constraint buddy_pass_referrals_discount_percent_check
      check (discount_percent between 1 and 100);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.buddy_pass_referrals'::regclass
      and conname = 'buddy_pass_referrals_reward_weeks_check'
  ) then
    alter table public.buddy_pass_referrals
      add constraint buddy_pass_referrals_reward_weeks_check
      check (reward_weeks > 0);
  end if;
end
$$;

create unique index if not exists buddy_pass_one_reward_per_user_unique
  on public.buddy_pass_referrals (referred_user_id)
  where referred_user_id is not null and status = 'rewarded';

alter table public.buddy_pass_referrals enable row level security;
revoke all on table public.buddy_pass_referrals from anon, authenticated;

create or replace function public.grant_buddy_pass_week(
  p_referrer_id uuid,
  p_weeks integer default 1
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_weeks is null or p_weeks <= 0 then
    raise exception 'reward weeks must be positive';
  end if;

  update public.profiles
  set
    buddy_pass_weeks_available = buddy_pass_weeks_available + p_weeks,
    buddy_pass_weeks_earned = buddy_pass_weeks_earned + p_weeks
  where id = p_referrer_id;

  if not found then
    raise exception 'referrer profile not found';
  end if;
end;
$$;

create or replace function public.activate_buddy_pass_week(p_user_id uuid)
returns table(active_until timestamptz, weeks_available integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_active_until timestamptz;
  current_weeks_available integer;
begin
  select
    buddy_pass_active_until,
    buddy_pass_weeks_available
  into current_active_until, current_weeks_available
  from public.profiles
  where id = p_user_id
  for update;

  if not found then
    raise exception 'profile not found';
  end if;

  if current_active_until is not null and current_active_until > now() then
    active_until := current_active_until;
    weeks_available := current_weeks_available;
    return next;
    return;
  end if;

  if current_weeks_available <= 0 then
    raise exception 'no buddy pass weeks available';
  end if;

  active_until := now() + interval '7 days';
  weeks_available := current_weeks_available - 1;

  update public.profiles
  set
    buddy_pass_weeks_available = weeks_available,
    buddy_pass_weeks_used = buddy_pass_weeks_used + 1,
    buddy_pass_active_until = active_until
  where id = p_user_id;

  return next;
end;
$$;

create or replace function public.record_buddy_pass_reward(
  p_referrer_id uuid,
  p_referred_user_id uuid,
  p_referral_code text,
  p_checkout_session_id text,
  p_stripe_customer_id text,
  p_price_id text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inserted_id uuid;
  v_normalized_code text;
  v_stored_code text;
begin
  if p_referrer_id is null or p_referred_user_id is null then
    raise exception 'referral users are required';
  end if;
  if p_referrer_id = p_referred_user_id then
    raise exception 'self referral is not allowed';
  end if;
  if p_checkout_session_id is null or btrim(p_checkout_session_id) = '' then
    raise exception 'checkout session is required';
  end if;
  if p_price_id is null or btrim(p_price_id) = '' then
    raise exception 'price is required';
  end if;

  v_normalized_code := left(
    upper(regexp_replace(coalesce(p_referral_code, ''), '[^a-zA-Z0-9]', '', 'g')),
    16
  );

  select referral_code
  into v_stored_code
  from public.profiles
  where id = p_referrer_id
  for update;

  if not found then
    raise exception 'referrer profile not found';
  end if;
  if v_stored_code is null or v_stored_code <> v_normalized_code then
    raise exception 'referral code does not belong to referrer';
  end if;

  insert into public.buddy_pass_referrals (
    referrer_id,
    referred_user_id,
    referral_code,
    checkout_session_id,
    stripe_customer_id,
    price_id,
    status,
    discount_percent,
    reward_weeks,
    rewarded_at
  ) values (
    p_referrer_id,
    p_referred_user_id,
    v_normalized_code,
    p_checkout_session_id,
    p_stripe_customer_id,
    p_price_id,
    'rewarded',
    25,
    1,
    now()
  )
  on conflict do nothing
  returning id into v_inserted_id;

  if v_inserted_id is null then
    return false;
  end if;

  update public.profiles
  set
    buddy_pass_weeks_available = buddy_pass_weeks_available + 1,
    buddy_pass_weeks_earned = buddy_pass_weeks_earned + 1
  where id = p_referrer_id;

  if not found then
    raise exception 'referrer profile not found';
  end if;

  return true;
end;
$$;

create or replace function public.void_buddy_pass_rewards(
  p_checkout_session_ids text[]
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_referral record;
  v_available integer;
  v_earned integer;
  v_used integer;
  v_from_available integer;
  v_from_used integer;
  v_voided integer := 0;
begin
  if coalesce(cardinality(p_checkout_session_ids), 0) = 0 then
    return 0;
  end if;

  for v_referral in
    select id, referrer_id, reward_weeks
    from public.buddy_pass_referrals
    where checkout_session_id = any(p_checkout_session_ids)
      and status = 'rewarded'
    for update
  loop
    select
      buddy_pass_weeks_available,
      buddy_pass_weeks_earned,
      buddy_pass_weeks_used
    into v_available, v_earned, v_used
    from public.profiles
    where id = v_referral.referrer_id
    for update;

    if not found then
      raise exception 'referrer profile not found';
    end if;
    if v_earned < v_referral.reward_weeks then
      raise exception 'referrer reward balance is inconsistent';
    end if;

    v_from_available := least(v_available, v_referral.reward_weeks);
    v_from_used := v_referral.reward_weeks - v_from_available;
    if v_used < v_from_used then
      raise exception 'referrer reward usage is inconsistent';
    end if;

    update public.profiles
    set
      buddy_pass_weeks_available = v_available - v_from_available,
      buddy_pass_weeks_earned = v_earned - v_referral.reward_weeks,
      buddy_pass_weeks_used = v_used - v_from_used
    where id = v_referral.referrer_id;

    update public.buddy_pass_referrals
    set status = 'void'
    where id = v_referral.id;

    v_voided := v_voided + 1;
  end loop;

  return v_voided;
end;
$$;

revoke all on function public.grant_buddy_pass_week(uuid, integer) from public, anon, authenticated;
revoke all on function public.activate_buddy_pass_week(uuid) from public, anon, authenticated;
revoke all on function public.record_buddy_pass_reward(uuid, uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.void_buddy_pass_rewards(text[]) from public, anon, authenticated;
grant execute on function public.grant_buddy_pass_week(uuid, integer) to service_role;
grant execute on function public.activate_buddy_pass_week(uuid) to service_role;
grant execute on function public.record_buddy_pass_reward(uuid, uuid, text, text, text, text) to service_role;
grant execute on function public.void_buddy_pass_rewards(text[]) to service_role;

-- add_affiliate_program.sql runs later in the repository's greenfield order.
-- Upgrade an existing installation here, while that migration defines the same
-- column/index when the referrals table does not exist yet.
do $$
begin
  if to_regclass('public.referrals') is not null then
    alter table public.referrals
      add column if not exists stripe_checkout_session_id text;
    create unique index if not exists referrals_checkout_session_unique
      on public.referrals (stripe_checkout_session_id);
  end if;
end
$$;
