-- TEST HARNESS ONLY. Do not run against production.
-- Minimal Supabase-compatible roles and auth.uid() stub for vanilla Postgres.
-- The real Supabase project already has these. This file is not a migration.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end $$;

alter role service_role bypassrls;
alter role authenticated set search_path = public, auth;
alter role anon set search_path = public, auth;
alter role service_role set search_path = public, auth;

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key,
  email text
);

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
  );
$$;

grant usage on schema auth, public to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;

-- The profile photo migration does not create storage tables. Hosted
-- Supabase already has them, with row level security, owned by
-- supabase_storage_admin. This stub is only for vanilla Postgres tests.
create schema if not exists storage;

create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null references storage.buckets (id),
  name text not null,
  owner uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  metadata jsonb,
  unique (bucket_id, name)
);

alter table storage.objects enable row level security;

grant usage on schema storage to anon, authenticated, service_role;
grant select on table storage.buckets to anon, authenticated, service_role;
grant select on table storage.objects to anon, authenticated, service_role;
grant insert, update, delete on table storage.objects to authenticated;

-- Match Supabase: tables and functions created by later migrations start with
-- broad grants. 20261030 then removes client writes to profiles.is_admin.
alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public
  grant execute on functions to anon, authenticated, service_role;
