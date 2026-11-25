-- RECONSTRUCTED from handoff description; verify against production before applying; do not run against prod without a separate production review
-- SWEATING / 20261030
-- Stop authenticated and anon clients from setting profiles.is_admin.
-- Production already denies is_admin writes. The catalog grants are:
-- authenticated INSERT on id, display_name, birth_year, gender,
-- profile_photo_url, sports, interests, bio, birth_date; UPDATE on that set
-- except id; SELECT on every column, which is the only privilege on
-- is_admin, created_at, and updated_at. anon has SELECT on every column.
-- birth_date is date and nullable. ADD COLUMN runs only when it is missing
-- and does not retype an existing column.
-- PUT /profiles/me on main writes id, display_name, birth_year, gender,
-- profile_photo_url, sports, interests, and bio. updated_at is maintained
-- by profiles_set_updated_at, which does not need an UPDATE grant.
-- Idempotent. Table-level UPDATE/INSERT is revoked first: a column-level
-- REVOKE does not override an existing table-level GRANT (Supabase column
-- privileges). The trigger is the backstop when a later grant restores
-- table-level UPDATE. It trusts the session role, not a client-settable JWT claim.

alter table public.profiles
  add column if not exists birth_date date;

revoke all on table public.profiles from public, anon, authenticated;

do $$
declare
  required text[] := array[
    'id',
    'display_name',
    'birth_year',
    'gender',
    'profile_photo_url',
    'sports',
    'interests',
    'bio',
    'birth_date',
    'is_admin',
    'created_at',
    'updated_at'
  ];
  missing text;
  col text;
begin
  select string_agg(required_name, ', ' order by required_name)
    into missing
  from unnest(required) as required_name
  where not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = required_name
  );

  if missing is not null then
    raise exception 'profiles is missing a catalog column: %', missing;
  end if;

  for col in
    select column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
  loop
    execute format(
      'revoke all (%I) on table public.profiles from public, anon, authenticated',
      col
    );
  end loop;
end $$;

grant select on table public.profiles to anon, authenticated;
grant insert (
  id,
  display_name,
  birth_year,
  gender,
  profile_photo_url,
  sports,
  interests,
  bio,
  birth_date
) on table public.profiles to authenticated;
grant update (
  display_name,
  birth_year,
  gender,
  profile_photo_url,
  sports,
  interests,
  bio,
  birth_date
) on table public.profiles to authenticated;

create or replace function public.protect_profiles_is_admin()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  privileged boolean := current_user in (
    'service_role',
    'postgres',
    'supabase_admin',
    'supabase_auth_admin'
  );
begin
  if tg_op = 'UPDATE' and new.is_admin is not distinct from old.is_admin then
    return new;
  end if;

  if tg_op = 'INSERT' and coalesce(new.is_admin, false) = false then
    return new;
  end if;

  if privileged then
    return new;
  end if;

  raise exception 'is_admin_change_forbidden'
    using errcode = '42501';
end;
$$;

revoke all on function public.protect_profiles_is_admin() from public;
grant execute on function public.protect_profiles_is_admin() to anon, authenticated, service_role;

drop trigger if exists profiles_protect_is_admin on public.profiles;
create trigger profiles_protect_is_admin
before insert or update of is_admin on public.profiles
for each row
execute function public.protect_profiles_is_admin();
