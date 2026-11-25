-- Undo 20261112_profile_photo_storage.sql.
-- Deletes objects in the profile-photos bucket, then the bucket row.
-- Does not drop the storage schema or any other bucket.
-- Does not change public.profiles. Members keep whatever profile_photo_url
-- was already stored. After this rollback those storage references no longer
-- point at a file.
-- Do not run this against a hosted project from CI.
--
-- Supabase refuses DELETE on storage.objects unless this transaction sets
-- storage.allow_delete_query. The setting is transaction-local and is not
-- kept after commit.

begin;

select set_config('storage.allow_delete_query', 'true', true);

do $$
begin
  if to_regclass('storage.objects') is not null then
    drop policy if exists profile_photos_owner_insert on storage.objects;
    drop policy if exists profile_photos_owner_update on storage.objects;
    drop policy if exists profile_photos_owner_delete on storage.objects;
    drop policy if exists profile_photos_select on storage.objects;
    delete from storage.objects where bucket_id = 'profile-photos';
  end if;

  if to_regclass('storage.buckets') is not null then
    delete from storage.buckets where id = 'profile-photos';
  end if;
end $$;

drop function if exists private.can_read_profile_photo(uuid);
drop function if exists private.profile_photo_owner_id(text);

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'private')
     and not exists (
       select 1
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'private'
     )
     and not exists (
       select 1
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'private'
         and c.relkind in ('r', 'p', 'v', 'm', 'f')
     )
  then
    drop schema private;
  end if;
end $$;

commit;
