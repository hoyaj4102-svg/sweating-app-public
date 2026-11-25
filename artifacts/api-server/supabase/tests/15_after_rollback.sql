-- Fail unless the public schema has no app relations or functions.
-- auth stubs are outside public and must remain.

do $$
declare
  relations integer;
  functions integer;
begin
  select count(*) into relations
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind in ('r', 'p', 'v', 'm', 'f');

  select count(*) into functions
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public';

  if relations <> 0 or functions <> 0 then
    raise exception 'rollback left public objects relations=% functions=%', relations, functions;
  end if;

  if to_regclass('auth.users') is null or to_regprocedure('auth.uid()') is null then
    raise exception 'rollback removed the auth stub';
  end if;

  if to_regprocedure('private.can_read_profile_photo(uuid)') is not null
     or to_regprocedure('private.profile_photo_owner_id(text)') is not null
     or to_regprocedure('private.is_approved_gym_owner()') is not null
     or to_regprocedure('private.acknowledge_owner_principles(text)') is not null then
    raise exception 'private helpers survived rollback';
  end if;

  if exists (select 1 from pg_catalog.pg_namespace where nspname = 'private') then
    raise exception 'rollback left the private schema';
  end if;

  if to_regclass('storage.buckets') is not null then
    if exists (select 1 from storage.buckets where id = 'profile-photos') then
      raise exception 'profile photo bucket survived rollback';
    end if;
  end if;

  if to_regclass('storage.objects') is not null
     and exists (
       select 1
       from pg_policies
       where schemaname = 'storage'
         and policyname like 'profile_photos_%'
     ) then
    raise exception 'profile photo policies survived rollback';
  end if;
end $$;
