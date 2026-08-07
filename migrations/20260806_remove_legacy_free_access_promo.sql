-- Retire the March 2026 test-only signup promo-code mechanism.
-- This is unrelated to Stripe promotion codes used by creator affiliates.
-- Existing profile access is deliberately preserved; this only prevents new
-- free-access redemptions.

begin;

drop function if exists public.redeem_promo_code(uuid, text);

-- Intentionally omit CASCADE. If an unexpected database object depends on the
-- table, fail and roll back instead of deleting that object implicitly.
drop table if exists public.promo_codes;

delete from public.api_usage_buckets
where scope = 'rate:promo';

commit;
