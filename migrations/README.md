# ResearchMatch database migration routes

Use the route that matches the destination. Do not run every SQL file
alphabetically. The repository retains older idempotent upgrade scripts for
existing installations, but some are superseded by the greenfield core and can
overwrite newer functions if replayed in the wrong order.

## Existing production sale: use native project transfer

For the ResearchMatch sale, transfer the existing Supabase project. The audited
project already contains the production users, data, referral tables, and the
three 2026-08-03 hardening migrations. Do **not** replay schema files during a
native organization-to-organization transfer.

Before and after transfer, run:

```bash
npm run handoff:check:production
```

## Brand-new project with no production data

Apply these files in this exact order:

1. `00000000_core_schema.sql`
2. `add_research_seo_pages.sql`
3. `add_affiliate_program.sql`
4. `20260720_sale_readiness.sql`
5. `20260803205117_referral_system_hardening.sql`
6. `20260803210704_referral_reversal_lock_order.sql`
7. `20260803214340_affiliate_commission_hardening.sql`
8. `add_professor_funding_status.sql`
9. `harden_profiles_rls.sql`
10. `20260806_remove_legacy_free_access_promo.sql`

Then generate TypeScript types, run the Supabase security/performance advisors,
and complete the test-mode acceptance paths in `TRANSFER.md` before deployment.

## Existing-project upgrade or restored production copy

Do not apply the greenfield baseline over restored production data. Restore the
source roles/schema/data first, compare its migration state and schema against
the source project, and apply only the missing upgrade scripts in a disposable
staging copy. `20260721_existing_production_upgrade.sql` exists for the older
production shape; `add_summaries_columns.sql`, `add_buddy_pass_referrals.sql`,
and `grandfather_weekly_email_checker.sql` are retained legacy upgrade paths.

If duplicate affiliate subscription referrals exist,
`add_affiliate_program.sql` intentionally stops. Reconcile them manually from
accounting evidence; never merge or delete financial history automatically.
