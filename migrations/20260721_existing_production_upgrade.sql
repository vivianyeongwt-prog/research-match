-- Bring an existing Research Match production project up to the repository's
-- reproducible schema without replaying the greenfield baseline.
--
-- This migration is additive and idempotent. It creates only tables that were
-- absent from the 2026-07-21 production preflight and does not modify existing
-- application rows.

create extension if not exists pgcrypto;

alter table public.profiles
  add column if not exists framework_used boolean not null default false;

create table if not exists public.pdf_downloads (
  id uuid primary key default gen_random_uuid(),
  email text not null,
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
  funding_status text check (
    funding_status is null
    or funding_status in ('ACTIVE', 'NOT_RECENT', 'UNKNOWN')
  ),
  last_funding_check timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists professors_openalex_author_id_unique
  on public.professors (openalex_author_id)
  where openalex_author_id is not null;

create unique index if not exists professors_openalex_id_unique
  on public.professors (openalex_id)
  where openalex_id is not null;

-- These tables contain operational records. Browser clients receive no direct
-- access; server routes use the service-role key after their own validation.
alter table public.pdf_downloads enable row level security;
alter table public.professors enable row level security;

revoke all on table public.pdf_downloads from anon, authenticated;
revoke all on table public.professors from anon, authenticated;
