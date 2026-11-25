-- SWEATING / 20261106
-- Stop anon and authenticated from writing class_participants directly.
-- Do not apply to production without a separate production review. CI uses a throwaway
-- Postgres only. This file does not replace complete_class, like_participant,
-- mark_attendance, or record_attendance.
--
-- Production already has this revoke (2026-11-04 08:12 KST): anon and
-- authenticated have SELECT only. Re-running on that state is a no-op for
-- grants. REVOKE of a privilege that is already gone does not error, and
-- GRANT SELECT does not put INSERT or UPDATE back.
-- TRUNCATE is included because it bypasses row level security.
-- SELECT stays: the classes read policy queries this table.
--
-- profiles.is_admin column grants, including birth_date, stay in 20261030.
-- This trigger is the same backstop. A table-level UPDATE grant overrides a
-- column-level revoke, and the trigger does not. It trusts the database
-- role, not a client JWT claim.

revoke all on table public.class_participants from public, anon, authenticated;
grant select on table public.class_participants to anon, authenticated;
grant select, insert, update, delete on table public.class_participants to service_role;

do $$
declare
  role_name text;
  privilege text;
begin
  foreach role_name in array array['anon', 'authenticated']
  loop
    if not has_table_privilege(role_name, 'public.class_participants', 'SELECT') then
      raise exception '% lost select on class_participants', role_name;
    end if;
    foreach privilege in array array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']
    loop
      if has_table_privilege(role_name, 'public.class_participants', privilege) then
        raise exception '% still has % on class_participants', role_name, privilege;
      end if;
    end loop;
  end loop;
end $$;

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
