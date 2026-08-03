-- Reproducible core schema for a fresh Research Match Supabase project.
-- Run before every other migration in this directory.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  plan_type text not null default 'free'
    check (plan_type in ('free', 'weekly', 'semester', 'student_monthly', 'student_annual', 'lifetime')),
  plan_expires_at timestamptz,
  searches_used integer not null default 0,
  searches_reset_at timestamptz,
  summaries_used integer not null default 0,
  summaries_reset_at timestamptz,
  referral_code text check (referral_code is null or referral_code ~ '^RM[A-Z0-9]{8,14}$'),
  buddy_pass_weeks_available integer not null default 0 check (buddy_pass_weeks_available >= 0),
  buddy_pass_weeks_earned integer not null default 0 check (buddy_pass_weeks_earned >= 0),
  buddy_pass_weeks_used integer not null default 0 check (buddy_pass_weeks_used >= 0),
  buddy_pass_active_until timestamptz,
  framework_used boolean not null default false,
  email_checker_grandfathered boolean not null default false,
  created_at timestamptz not null default now(),
  constraint profiles_buddy_pass_balance_check
    check (buddy_pass_weeks_available + buddy_pass_weeks_used = buddy_pass_weeks_earned)
);

create unique index if not exists profiles_referral_code_unique
  on public.profiles (referral_code) where referral_code is not null;

-- This table is defined in the core migration because the sale-readiness
-- migration creates an atomic reward function that depends on it. The older
-- Buddy Pass migration remains idempotent for existing installations.
create table if not exists public.buddy_pass_referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_id uuid not null references public.profiles(id) on delete cascade,
  referred_user_id uuid references public.profiles(id) on delete set null,
  referral_code text not null check (referral_code ~ '^RM[A-Z0-9]{8,14}$'),
  checkout_session_id text not null unique,
  stripe_customer_id text,
  price_id text,
  status text not null default 'rewarded'
    check (status in ('rewarded', 'void')),
  discount_percent integer not null default 25 check (discount_percent between 1 and 100),
  reward_weeks integer not null default 1 check (reward_weeks > 0),
  created_at timestamptz not null default now(),
  rewarded_at timestamptz not null default now(),
  constraint buddy_pass_no_self_referral
    check (referred_user_id is null or referrer_id <> referred_user_id)
);
create index if not exists buddy_pass_referrals_referrer_idx
  on public.buddy_pass_referrals (referrer_id, created_at desc);
create index if not exists buddy_pass_referrals_referred_idx
  on public.buddy_pass_referrals (referred_user_id);
create unique index if not exists buddy_pass_one_reward_per_user_unique
  on public.buddy_pass_referrals (referred_user_id)
  where referred_user_id is not null and status = 'rewarded';

create table if not exists public.contact_messages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  message text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  content text not null,
  category text not null default 'General Feedback',
  author_name text not null default 'Anonymous',
  upvotes integer not null default 0 check (upvotes >= 0),
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.pdf_downloads (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.waitlist (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  tier text not null,
  created_at timestamptz not null default now(),
  unique (email, tier)
);

create table if not exists public.search_logs (
  -- Keep this UUID contract aligned with the production table so its complete
  -- search history can be restored into a fresh project without rewriting IDs.
  id uuid primary key default gen_random_uuid(),
  research_interest text,
  university text,
  is_authenticated boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists search_logs_created_at_idx on public.search_logs (created_at desc);

create table if not exists public.promo_codes (
  code text primary key,
  uses_remaining integer not null default 0 check (uses_remaining >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.professors (
  id uuid primary key default gen_random_uuid(),
  name text,
  display_name text,
  institution text,
  last_known_institution text,
  openalex_author_id text,
  openalex_id text,
  funding_status text check (funding_status is null or funding_status in ('ACTIVE', 'NOT_RECENT', 'UNKNOWN')),
  last_funding_check timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists professors_openalex_author_id_unique
  on public.professors (openalex_author_id) where openalex_author_id is not null;
create unique index if not exists professors_openalex_id_unique
  on public.professors (openalex_id) where openalex_id is not null;

-- Browser roles receive no direct access to operational or user-submitted data.
-- Application API routes use the service-role key and validate each operation.
alter table public.contact_messages enable row level security;
alter table public.feedback enable row level security;
alter table public.pdf_downloads enable row level security;
alter table public.waitlist enable row level security;
alter table public.search_logs enable row level security;
alter table public.promo_codes enable row level security;
alter table public.professors enable row level security;
alter table public.buddy_pass_referrals enable row level security;
revoke all on table public.buddy_pass_referrals from anon, authenticated;

-- Auth signup creates the profile durably inside the database transaction. Client
-- lazy creation remains only as a recovery path for legacy accounts.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, plan_type, referral_code)
  values (
    new.id,
    coalesce(new.email, ''),
    'free',
    'RM' || upper(substr(replace(new.id::text, '-', ''), 1, 14))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();
