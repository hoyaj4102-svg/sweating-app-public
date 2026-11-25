-- SWEATING / 20261114 consent and self account deletion
-- Do not apply to a hosted or production project from this change.
-- Preview uses the production database. Applying this file there needs a
-- a separate production review after this draft is reviewed.
--
-- Runs after 20261113_owner_announcements.sql. Does not replace or drop
-- private.profile_photo_owner_id, private.can_read_profile_photo, the
-- profile-photos policies, private.is_approved_gym_owner, or the
-- announcement tables. Does not drop schema private.
--
-- Required consents, each stored with the current document version and the
-- time it was accepted:
--   terms, privacy (collection and use), overseas_transfer.
-- The version is public.current_consent_version(). Bump that function when
-- the legal text changes. Members who have not accepted the new version are
-- asked again. Older rows stay as history.
--
-- Authenticated profile inserts and updates for the caller's own row fail
-- with consent_required until all three current consents exist. postgres,
-- supabase_admin, and service_role keep the previous maintenance path.
-- A write for a different id is left to the existing privileges and RLS.
--
-- delete_own_account() deletes only auth.uid(). Profiles, participants,
-- likes, matches, gym owner rows, and consent rows then cascade. It refuses
-- when that member owns a gym with a draft or published class whose
-- scheduled_at is still in the future. Past, cancelled, and completed
-- classes do not block. The gym and its classes stay; only the owner link
-- disappears.
-- Profile photos are not deleted here. storage.protect_delete rejects a
-- direct DELETE on storage.objects. The API removes profile-photos objects
-- through the Storage API before it calls delete_own_account().
-- account_deletion_log stores the time of a deletion and nothing else.

drop function if exists public.delete_own_storage_objects(uuid);

create or replace function public.current_consent_version()
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select '2026-11-12'::text;
$$;

revoke all on function public.current_consent_version() from public, anon, authenticated, service_role;
grant execute on function public.current_consent_version() to authenticated, service_role;

create table if not exists public.user_consents (
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('terms', 'privacy', 'overseas_transfer')),
  version text not null check (char_length(version) between 1 and 32),
  accepted_at timestamptz not null default now(),
  primary key (user_id, kind, version)
);

create index if not exists user_consents_user_idx
  on public.user_consents (user_id, accepted_at desc);

create table if not exists public.account_deletion_log (
  id uuid primary key default gen_random_uuid(),
  deleted_at timestamptz not null default now()
);

alter table public.user_consents enable row level security;
alter table public.account_deletion_log enable row level security;

revoke all on table public.user_consents from public, anon, authenticated, service_role;
revoke all on table public.account_deletion_log from public, anon, authenticated, service_role;
grant select on table public.user_consents to authenticated;
grant all on table public.user_consents to service_role;

drop policy if exists "user_consents_select_own" on public.user_consents;
create policy "user_consents_select_own"
on public.user_consents
for select
to authenticated
using (user_id = auth.uid());

comment on table public.user_consents is
  'One row per accepted document version. No client insert, update, or delete.';
comment on table public.account_deletion_log is
  'Count and time of self-service deletions. No user id, email, or other PII.';

create or replace function public.consents_current(p_user_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select case
    when p_user_id is null then false
    when auth.uid() is not null and p_user_id is distinct from auth.uid() then false
    else (
      select count(distinct consent.kind) = 3
      from public.user_consents as consent
      where consent.user_id = p_user_id
        and consent.version = public.current_consent_version()
        and consent.kind in ('terms', 'privacy', 'overseas_transfer')
    )
  end;
$$;

revoke all on function public.consents_current(uuid) from public, anon, authenticated, service_role;
grant execute on function public.consents_current(uuid) to authenticated, service_role;

create or replace function public.current_consents_complete()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select public.consents_current(auth.uid());
$$;

revoke all on function public.current_consents_complete() from public, anon, authenticated, service_role;
grant execute on function public.current_consents_complete() to authenticated;

create or replace function public.record_own_consents(
  p_terms boolean,
  p_privacy boolean,
  p_overseas boolean
)
returns setof public.user_consents
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;
  if p_terms is not true or p_privacy is not true or p_overseas is not true then
    raise exception 'consent_required';
  end if;

  insert into public.user_consents (user_id, kind, version)
  values
    (uid, 'terms', public.current_consent_version()),
    (uid, 'privacy', public.current_consent_version()),
    (uid, 'overseas_transfer', public.current_consent_version())
  on conflict (user_id, kind, version) do nothing;

  return query
    select *
    from public.user_consents
    where user_id = uid
      and version = public.current_consent_version()
    order by kind;
end;
$$;

revoke all on function public.record_own_consents(boolean, boolean, boolean) from public, anon, authenticated, service_role;
grant execute on function public.record_own_consents(boolean, boolean, boolean) to authenticated;

create or replace function public.enforce_profile_consents()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user in ('service_role', 'postgres', 'supabase_admin', 'supabase_auth_admin') then
    return new;
  end if;
  if auth.uid() is null or new.id is distinct from auth.uid() then
    return new;
  end if;
  if not public.consents_current(new.id) then
    raise exception 'consent_required';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_profile_consents() from public, anon, authenticated, service_role;
grant execute on function public.enforce_profile_consents() to authenticated, service_role;

drop trigger if exists profiles_z_require_consents on public.profiles;
create trigger profiles_z_require_consents
before insert or update on public.profiles
for each row
execute function public.enforce_profile_consents();

create or replace function public.assert_own_account_deletable()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;

  if exists (
    select 1
    from public.gym_owners as owner_row
    join public.classes as class_row on class_row.gym_id = owner_row.gym_id
    where owner_row.user_id = uid
      and class_row.status in ('draft', 'published')
      and class_row.scheduled_at > now()
  ) then
    raise exception 'gym_owner_upcoming_classes';
  end if;
end;
$$;

revoke all on function public.assert_own_account_deletable() from public, anon, authenticated, service_role;
grant execute on function public.assert_own_account_deletable() to authenticated;

create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;

  perform public.assert_own_account_deletable();

  insert into public.account_deletion_log (deleted_at)
  values (now());

  delete from auth.users
  where id = uid;
end;
$$;

revoke all on function public.delete_own_account() from public, anon, authenticated, service_role;
grant execute on function public.delete_own_account() to authenticated;

comment on function public.delete_own_account() is
  'Deletes auth.uid() only. Does not delete storage.objects. Blocks a gym owner who still has an upcoming draft or published class.';
