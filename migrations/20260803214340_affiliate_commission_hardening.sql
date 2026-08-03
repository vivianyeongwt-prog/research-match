-- Make affiliate commissions deterministic across duplicate, concurrent, and
-- out-of-order Stripe webhook deliveries.

create table if not exists public.affiliate_payment_reversals (
  stripe_reference text primary key,
  net_amount_cents integer not null,
  reason text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint affiliate_payment_reversals_reference_check
    check (btrim(stripe_reference) <> ''),
  constraint affiliate_payment_reversals_net_amount_check
    check (net_amount_cents >= 0),
  constraint affiliate_payment_reversals_reason_check
    check (reason in ('refund', 'dispute'))
);

alter table public.affiliate_payment_reversals enable row level security;

revoke all on table public.affiliates, public.referrals, public.commissions,
  public.payouts, public.processed_stripe_events,
  public.affiliate_payment_reversals from public, anon, authenticated;
grant select, insert, update, delete on table public.affiliate_payment_reversals
  to service_role;

do $$
begin
  if exists (
    select 1
    from public.commissions c
    join public.referrals r on r.id = c.referral_id
    where c.affiliate_id <> r.affiliate_id
  ) then
    raise exception 'Commission/referral affiliate mismatches require manual review';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.affiliates'::regclass
      and conname = 'affiliates_commission_rate_check'
  ) then
    alter table public.affiliates
      add constraint affiliates_commission_rate_check
      check (commission_rate between 0 and 1);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.commissions'::regclass
      and conname = 'commissions_amount_cents_check'
  ) then
    alter table public.commissions
      add constraint commissions_amount_cents_check
      check (amount_cents >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.commissions'::regclass
      and conname = 'commissions_status_check'
  ) then
    alter table public.commissions
      add constraint commissions_status_check
      check (status in ('pending', 'paid', 'void'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.referrals'::regclass
      and conname = 'referrals_id_affiliate_unique'
  ) then
    alter table public.referrals
      add constraint referrals_id_affiliate_unique unique (id, affiliate_id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.commissions'::regclass
      and conname = 'commissions_referral_affiliate_fkey'
  ) then
    alter table public.commissions
      add constraint commissions_referral_affiliate_fkey
      foreign key (referral_id, affiliate_id)
      references public.referrals (id, affiliate_id)
      not valid;
    alter table public.commissions
      validate constraint commissions_referral_affiliate_fkey;
  end if;
end
$$;

create index if not exists commissions_referral_affiliate_idx
  on public.commissions (referral_id, affiliate_id);

-- The same advisory lock is taken by reversal reconciliation below. A refund
-- that races checkout attribution therefore cannot slip between the reversal
-- lookup and commission insert.
create or replace function public.record_affiliate_commission(
  p_affiliate_id uuid,
  p_referral_id uuid,
  p_stripe_reference text,
  p_gross_amount_cents integer,
  p_currency text,
  p_commission_rate numeric
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_reference text;
  v_currency text;
  v_reversal_net integer;
  v_reversal_reason text;
  v_effective_net integer;
  v_amount integer;
  v_status text;
  v_existing public.commissions%rowtype;
  v_inserted public.commissions%rowtype;
begin
  v_reference := btrim(coalesce(p_stripe_reference, ''));
  v_currency := lower(btrim(coalesce(p_currency, 'usd')));

  if p_affiliate_id is null or p_referral_id is null then
    raise exception 'affiliate and referral are required';
  end if;
  if v_reference = '' then
    raise exception 'Stripe payment reference is required';
  end if;
  if p_gross_amount_cents is null or p_gross_amount_cents < 0 then
    raise exception 'gross amount must be nonnegative';
  end if;
  if p_commission_rate is null or p_commission_rate < 0 or p_commission_rate > 1 then
    raise exception 'commission rate must be between zero and one';
  end if;
  if v_currency !~ '^[a-z]{3}$' then
    raise exception 'currency must be a three-letter lowercase code';
  end if;
  if not exists (
    select 1
    from public.referrals
    where id = p_referral_id and affiliate_id = p_affiliate_id
  ) then
    raise exception 'referral does not belong to affiliate';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_reference, 0)
  );

  select net_amount_cents, reason
  into v_reversal_net, v_reversal_reason
  from public.affiliate_payment_reversals
  where stripe_reference = v_reference;

  v_effective_net := least(
    p_gross_amount_cents,
    coalesce(v_reversal_net, p_gross_amount_cents)
  );
  v_status := case
    when v_reversal_reason = 'dispute' or v_effective_net = 0 then 'void'
    else 'pending'
  end;
  -- Keep the original eligible amount on fully voided rows for auditability.
  v_amount := round(
    (case when v_effective_net = 0 then p_gross_amount_cents else v_effective_net end)
    * p_commission_rate
  )::integer;

  select * into v_existing
  from public.commissions
  where stripe_invoice_id = v_reference
  for update;

  if found then
    return jsonb_build_object(
      'inserted', false,
      'status', v_existing.status,
      'amount_cents', v_existing.amount_cents
    );
  end if;

  insert into public.commissions (
    affiliate_id,
    referral_id,
    stripe_invoice_id,
    amount_cents,
    currency,
    status
  ) values (
    p_affiliate_id,
    p_referral_id,
    v_reference,
    v_amount,
    v_currency,
    v_status
  )
  returning * into v_inserted;

  return jsonb_build_object(
    'inserted', true,
    'status', v_inserted.status,
    'amount_cents', v_inserted.amount_cents
  );
end;
$$;

-- Persist reversal state before changing existing rows. Later checkout or
-- invoice webhooks see this ledger and create a voided/adjusted commission even
-- when Stripe delivered the reversal first.
create or replace function public.reconcile_affiliate_commissions(
  p_stripe_references text[],
  p_net_amount_cents integer,
  p_reason text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_references text[];
  v_reference text;
  v_commission record;
  v_new_amount integer;
  v_voided integer := 0;
  v_adjusted integer := 0;
  v_paid_requires_review integer := 0;
begin
  select array_agg(distinct btrim(reference) order by btrim(reference))
  into v_references
  from unnest(coalesce(p_stripe_references, array[]::text[])) as reference
  where btrim(coalesce(reference, '')) <> '';

  if coalesce(cardinality(v_references), 0) = 0 then
    return jsonb_build_object(
      'voided', 0,
      'adjusted', 0,
      'paid_requires_review', 0
    );
  end if;
  if p_net_amount_cents is null or p_net_amount_cents < 0 then
    raise exception 'net amount must be nonnegative';
  end if;
  if p_reason not in ('refund', 'dispute') then
    raise exception 'unsupported reversal reason';
  end if;

  foreach v_reference in array v_references
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(v_reference, 0)
    );
  end loop;

  foreach v_reference in array v_references
  loop
    insert into public.affiliate_payment_reversals (
      stripe_reference,
      net_amount_cents,
      reason,
      updated_at
    ) values (
      v_reference,
      p_net_amount_cents,
      p_reason,
      now()
    )
    on conflict (stripe_reference) do update
    set
      net_amount_cents = least(
        public.affiliate_payment_reversals.net_amount_cents,
        excluded.net_amount_cents
      ),
      reason = case
        when public.affiliate_payment_reversals.reason = 'dispute'
          or excluded.reason = 'dispute'
        then 'dispute'
        else 'refund'
      end,
      updated_at = now();
  end loop;

  for v_commission in
    select
      c.id,
      c.status,
      c.amount_cents,
      a.commission_rate,
      r.net_amount_cents,
      r.reason
    from public.commissions c
    join public.affiliates a on a.id = c.affiliate_id
    join public.affiliate_payment_reversals r
      on r.stripe_reference = c.stripe_invoice_id
    where c.stripe_invoice_id = any(v_references)
    for update of c
  loop
    if v_commission.status = 'paid' then
      v_paid_requires_review := v_paid_requires_review + 1;
      continue;
    end if;
    if v_commission.status <> 'pending' then
      continue;
    end if;

    if v_commission.reason = 'dispute'
      or v_commission.net_amount_cents = 0
    then
      update public.commissions
      set status = 'void'
      where id = v_commission.id;
      v_voided := v_voided + 1;
    else
      v_new_amount := round(
        v_commission.net_amount_cents * v_commission.commission_rate
      )::integer;
      if v_new_amount <= 0 then
        update public.commissions
        set status = 'void'
        where id = v_commission.id;
        v_voided := v_voided + 1;
      elsif v_new_amount < v_commission.amount_cents then
        update public.commissions
        set amount_cents = v_new_amount
        where id = v_commission.id;
        v_adjusted := v_adjusted + 1;
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'voided', v_voided,
    'adjusted', v_adjusted,
    'paid_requires_review', v_paid_requires_review
  );
end;
$$;

revoke all on function public.record_affiliate_commission(
  uuid, uuid, text, integer, text, numeric
) from public, anon, authenticated;
revoke all on function public.reconcile_affiliate_commissions(
  text[], integer, text
) from public, anon, authenticated;
grant execute on function public.record_affiliate_commission(
  uuid, uuid, text, integer, text, numeric
) to service_role;
grant execute on function public.reconcile_affiliate_commissions(
  text[], integer, text
) to service_role;

notify pgrst, 'reload schema';
