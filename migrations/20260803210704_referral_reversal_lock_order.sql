-- Keep Buddy reward grants and reversals on the same profile-then-referral lock
-- order. This removes a rare deadlock window when a refund races a new checkout.

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
    order by referrer_id, id
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

    -- A concurrent reversal may have voided this row while this transaction was
    -- waiting for the profile lock. Only the transaction that changes the status
    -- is allowed to change the counters.
    update public.buddy_pass_referrals
    set status = 'void'
    where id = v_referral.id
      and status = 'rewarded';
    if not found then
      continue;
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

    v_voided := v_voided + 1;
  end loop;

  return v_voided;
end;
$$;

revoke all on function public.void_buddy_pass_rewards(text[]) from public, anon, authenticated;
grant execute on function public.void_buddy_pass_rewards(text[]) to service_role;
