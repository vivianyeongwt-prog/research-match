-- Harden RLS on public.profiles.
--
-- Why: the profiles row is created from the browser at signup (src/lib/auth-context.tsx),
-- so without a strict WITH CHECK a tampered client could insert plan_type='lifetime'
-- (free paid access) or someone else's email. API routes now use the auth-verified
-- email for Stripe lookups, but the table itself should also refuse bad rows.
--
-- The only client-side writes in the app are: SELECT own row, and the signup /
-- lazy-create INSERT with plan_type='free' and the user's own email. Everything else
-- (plan changes, usage counters, promo grants) goes through API routes using the
-- service role, which bypasses RLS and these grants.
--
-- This drops ALL existing policies on profiles FIRST. Postgres combines permissive
-- policies with OR, so a leftover default policy (e.g. Supabase's "Enable insert for
-- authenticated users") would silently defeat the restrictive policies below. We
-- recreate exactly the two the app needs.
--
-- Apply in the Supabase SQL editor. Run the verification query at the bottom after.

alter table public.profiles enable row level security;

do $$
declare pol record;
begin
  for pol in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'profiles'
  loop
    execute format('drop policy if exists %I on public.profiles', pol.policyname);
  end loop;
end $$;

-- Signup / lazy-create insert: own id, own (auth-verified) email, and no
-- entitlement-bearing values. Checking only plan_type='free' is insufficient:
-- buddy_pass_active_until can independently grant paid access.
create policy "profiles self insert free only"
  on public.profiles for insert
  to authenticated
  with check (
    id = auth.uid()
    and plan_type = 'free'
    and lower(email) = lower(coalesce(auth.email(), ''))
    and plan_expires_at is null
    and coalesce(searches_used, 0) = 0
    and coalesce(summaries_used, 0) between 0 and 2
    and coalesce(buddy_pass_weeks_available, 0) = 0
    and coalesce(buddy_pass_weeks_earned, 0) = 0
    and coalesce(buddy_pass_weeks_used, 0) = 0
    and buddy_pass_active_until is null
    and coalesce(framework_used, false) = false
    and coalesce(email_checker_grandfathered, false) = false
  );

-- Users read their own profile.
create policy "profiles self select"
  on public.profiles for select
  to authenticated
  using (id = auth.uid());

-- No client-side updates or deletes at all (nothing in the app does them).
revoke update, delete on table public.profiles from anon, authenticated;

-- Verify: expect exactly two rows — the insert and select policies above.
--   select policyname, cmd, roles, qual, with_check
--   from pg_policies
--   where schemaname = 'public' and tablename = 'profiles'
--   order by cmd;
