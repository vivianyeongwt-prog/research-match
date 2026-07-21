-- Sale-readiness hardening: durable API quotas and atomic Buddy Pass rewards.
-- Apply this migration before deploying the matching application code.

create extension if not exists pgcrypto;

alter table public.profiles add column if not exists plan_expires_at timestamptz;

create table if not exists public.api_usage_buckets (
  scope text not null,
  subject_hash text not null,
  window_seconds integer not null default 0,
  bucket_start timestamptz not null,
  count integer not null default 0 check (count >= 0),
  updated_at timestamptz not null default now(),
  primary key (scope, subject_hash, window_seconds, bucket_start)
);

alter table public.api_usage_buckets enable row level security;

create or replace function public.consume_api_usage(
  p_scope text,
  p_subject_hash text,
  p_limit integer,
  p_window_seconds integer default 0
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bucket_start timestamptz;
  v_count integer;
begin
  if p_scope is null or p_scope = '' or p_subject_hash is null or p_subject_hash = '' or p_limit <= 0 then
    return false;
  end if;

  if p_window_seconds <= 0 then
    v_bucket_start := '1970-01-01 00:00:00+00'::timestamptz;
  else
    v_bucket_start := to_timestamp(
      floor(extract(epoch from clock_timestamp()) / p_window_seconds) * p_window_seconds
    );
    delete from public.api_usage_buckets
      where scope = p_scope
        and subject_hash = p_subject_hash
        and window_seconds = p_window_seconds
        and bucket_start < v_bucket_start;
  end if;

  insert into public.api_usage_buckets (
    scope, subject_hash, window_seconds, bucket_start, count, updated_at
  ) values (
    p_scope, p_subject_hash, greatest(p_window_seconds, 0), v_bucket_start, 1, now()
  )
  on conflict (scope, subject_hash, window_seconds, bucket_start)
  do update set
    count = public.api_usage_buckets.count + 1,
    updated_at = now()
  where public.api_usage_buckets.count < p_limit
  returning count into v_count;

  return v_count is not null;
end;
$$;

create or replace function public.release_api_usage(
  p_scope text,
  p_subject_hash text,
  p_window_seconds integer default 0
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bucket_start timestamptz;
begin
  if p_window_seconds <= 0 then
    v_bucket_start := '1970-01-01 00:00:00+00'::timestamptz;
  else
    v_bucket_start := to_timestamp(
      floor(extract(epoch from clock_timestamp()) / p_window_seconds) * p_window_seconds
    );
  end if;
  update public.api_usage_buckets
    set count = greatest(count - 1, 0), updated_at = now()
    where scope = p_scope
      and subject_hash = p_subject_hash
      and window_seconds = greatest(p_window_seconds, 0)
      and bucket_start = v_bucket_start;
end;
$$;

revoke all on function public.consume_api_usage(text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.release_api_usage(text, text, integer) from public, anon, authenticated;
grant execute on function public.consume_api_usage(text, text, integer, integer) to service_role;
grant execute on function public.release_api_usage(text, text, integer) to service_role;

create table if not exists public.anon_summary_uses (
  ip text primary key,
  count integer not null default 0 check (count >= 0),
  first_used_at timestamptz not null default now()
);
create unique index if not exists anon_summary_uses_ip_unique on public.anon_summary_uses (ip);
alter table public.anon_summary_uses enable row level security;

-- Reserve a free summary before expensive upstream work. The update is a single
-- locked statement, so parallel requests cannot all pass the same remaining slot.
create or replace function public.consume_summary_quota(
  p_user_id uuid,
  p_anon_subject text,
  p_limit integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if p_limit <= 0 then return false; end if;
  if p_user_id is not null then
    update public.profiles
      set summaries_used = coalesce(summaries_used, 0) + 1
      where id = p_user_id and coalesce(summaries_used, 0) < p_limit
      returning summaries_used into v_count;
  elsif p_anon_subject is not null and p_anon_subject <> '' then
    insert into public.anon_summary_uses (ip, count, first_used_at)
      values (p_anon_subject, 1, now())
    on conflict (ip) do update
      set count = public.anon_summary_uses.count + 1
      where public.anon_summary_uses.count < p_limit
    returning count into v_count;
  end if;
  return v_count is not null;
end;
$$;

create or replace function public.release_summary_quota(
  p_user_id uuid,
  p_anon_subject text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_id is not null then
    update public.profiles
      set summaries_used = greatest(coalesce(summaries_used, 0) - 1, 0)
      where id = p_user_id;
  elsif p_anon_subject is not null and p_anon_subject <> '' then
    update public.anon_summary_uses
      set count = greatest(count - 1, 0)
      where ip = p_anon_subject;
  end if;
end;
$$;

revoke all on function public.consume_summary_quota(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.release_summary_quota(uuid, text) from public, anon, authenticated;
grant execute on function public.consume_summary_quota(uuid, text, integer) to service_role;
grant execute on function public.release_summary_quota(uuid, text) to service_role;

-- The reward and the referral record commit in one transaction. A webhook retry is
-- therefore either a harmless no-op or completes the whole reward, never half of it.
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
set search_path = public
as $$
declare
  v_inserted_id uuid;
begin
  if p_referrer_id = p_referred_user_id then
    raise exception 'self referral is not allowed';
  end if;

  if exists (
    select 1 from public.buddy_pass_referrals
    where checkout_session_id = p_checkout_session_id
       or (referred_user_id = p_referred_user_id and status = 'rewarded')
  ) then
    return false;
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
    p_referral_code,
    p_checkout_session_id,
    p_stripe_customer_id,
    p_price_id,
    'rewarded',
    25,
    1,
    now()
  )
  returning id into v_inserted_id;

  update public.profiles
  set
    buddy_pass_weeks_available = coalesce(buddy_pass_weeks_available, 0) + 1,
    buddy_pass_weeks_earned = coalesce(buddy_pass_weeks_earned, 0) + 1
  where id = p_referrer_id;

  if not found then
    raise exception 'referrer profile not found';
  end if;

  return v_inserted_id is not null;
end;
$$;

revoke all on function public.record_buddy_pass_reward(uuid, uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.record_buddy_pass_reward(uuid, uuid, text, text, text, text) to service_role;

create or replace function public.increment_upvotes(row_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.feedback set upvotes = coalesce(upvotes, 0) + 1 where id = row_id;
$$;

revoke all on function public.increment_upvotes(uuid) from public, anon, authenticated;
grant execute on function public.increment_upvotes(uuid) to service_role;

create or replace function public.redeem_promo_code(p_user_id uuid, p_code text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_remaining integer;
  v_plan text;
  v_expires timestamptz;
begin
  select uses_remaining into v_remaining
  from public.promo_codes where code = upper(trim(p_code)) for update;
  if not found then return 'invalid'; end if;
  if v_remaining <= 0 then return 'expired'; end if;

  select plan_type, plan_expires_at into v_plan, v_expires
  from public.profiles where id = p_user_id for update;
  if not found then raise exception 'profile not found'; end if;
  if v_plan = 'lifetime' or (v_plan = 'semester' and (v_expires is null or v_expires > now())) then
    return 'already_paid';
  end if;

  update public.promo_codes
    set uses_remaining = uses_remaining - 1
    where code = upper(trim(p_code));
  update public.profiles
    set plan_type = 'semester', plan_expires_at = now() + interval '4 months'
    where id = p_user_id;
  return 'success';
end;
$$;

revoke all on function public.redeem_promo_code(uuid, text) from public, anon, authenticated;
grant execute on function public.redeem_promo_code(uuid, text) to service_role;
