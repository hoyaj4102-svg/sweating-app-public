-- SWEATING / 20261112 private profile photos
-- Do not apply to a hosted project without a separate a separate production review.
-- Do not create the bucket from the Preview deployment. Preview uses the
-- production database, and this file is for local Postgres and a future
-- approved production apply only.
--
-- Does not insert, update, or delete public.profiles. Existing
-- profile_photo_url values stay as they are. A storage reference is written
-- only when a member uploads a new file through the API.
--
-- Read-only inventory, not executed here:
--   select count(*) filter (where btrim(profile_photo_url) <> '') as nonempty_photo_values,
--          count(*) filter (where profile_photo_url like 'profile-photos/%') as storage_refs
--   from public.profiles;
--
-- Bucket profile-photos is private. Object names are
-- {user_id}/avatar.jpg, avatar.jpeg, avatar.png, or avatar.webp.
-- Authenticated users can insert, update, and delete only their own object.
-- Select is the owner, an admin, or an attended peer of a completed class
-- whose age preferences both allow the pair. Anonymous users have no policy.
-- Images are still served by short-lived signed URLs from the API. There is
-- no public object URL.
--
-- Does not create or alter storage.buckets or storage.objects. Hosted
-- Supabase already has those tables, with row level security enabled, owned
-- by supabase_storage_admin. The postgres role has no CREATE on schema storage.
-- Apply this only where that storage schema is already present.
--
-- Does not replace join_class, like_participant, revealed_participant_user_ids,
-- record_attendance, or complete_class. Re-applying an older file after
-- 20261108 still downgrades the reveal functions. Gym owner functions stay
-- as defined by 20261112_gym_owner_classes.

grant usage on schema storage to anon, authenticated, service_role;
grant select on table storage.buckets to anon, authenticated, service_role;
grant select on table storage.objects to anon, authenticated, service_role;
grant insert, update, delete on table storage.objects to authenticated;

insert into storage.buckets (id, name, public)
values ('profile-photos', 'profile-photos', false)
on conflict (id) do update
set name = excluded.name,
    public = false;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'storage'
      and table_name = 'buckets'
      and column_name = 'file_size_limit'
  ) then
    update storage.buckets
    set file_size_limit = 5242880
    where id = 'profile-photos';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'storage'
      and table_name = 'buckets'
      and column_name = 'allowed_mime_types'
  ) then
    update storage.buckets
    set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']::text[]
    where id = 'profile-photos';
  end if;
end $$;

create schema if not exists private;

revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.profile_photo_owner_id(p_name text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when split_part(p_name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and (
        p_name = split_part(p_name, '/', 1) || '/avatar.jpg'
        or p_name = split_part(p_name, '/', 1) || '/avatar.jpeg'
        or p_name = split_part(p_name, '/', 1) || '/avatar.png'
        or p_name = split_part(p_name, '/', 1) || '/avatar.webp'
      )
    then split_part(p_name, '/', 1)::uuid
    else null
  end;
$$;

revoke all on function private.profile_photo_owner_id(text) from public, anon;
grant execute on function private.profile_photo_owner_id(text) to authenticated;

-- Same attendance and completion gate as revealed_participant_user_ids.
-- Age uses age_preferences_allow for both people, including when a birth year
-- is missing. A missing birth year does not open the photo.
create or replace function private.can_read_profile_photo(p_owner_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  viewer uuid := auth.uid();
begin
  if p_owner_id is null or viewer is null then
    return false;
  end if;

  if p_owner_id = viewer or public.is_admin() then
    return true;
  end if;

  return exists (
    select 1
    from public.class_participants mine
    join public.class_participants theirs
      on theirs.class_id = mine.class_id
    join public.classes class_row
      on class_row.id = mine.class_id
    left join public.profiles viewer_profile
      on viewer_profile.id = viewer
    left join public.profiles target
      on target.id = p_owner_id
    where mine.user_id = viewer
      and mine.attendance_status = 'attended'
      and theirs.user_id = p_owner_id
      and theirs.user_id <> mine.user_id
      and theirs.attendance_status = 'attended'
      and class_row.status = 'completed'
      and now() >= public.class_scheduled_end(class_row.scheduled_at, class_row.duration_minutes)
      and public.age_preferences_allow(
        viewer_profile.birth_year,
        viewer_profile.age_preference,
        target.birth_year,
        target.age_preference
      )
  );
end;
$$;

revoke all on function private.can_read_profile_photo(uuid) from public, anon;
grant execute on function private.can_read_profile_photo(uuid) to authenticated;

drop policy if exists profile_photos_owner_insert on storage.objects;
create policy profile_photos_owner_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'profile-photos'
  and private.profile_photo_owner_id(name) = (select auth.uid())
);

drop policy if exists profile_photos_owner_update on storage.objects;
create policy profile_photos_owner_update
on storage.objects
for update
to authenticated
using (
  bucket_id = 'profile-photos'
  and private.profile_photo_owner_id(name) = (select auth.uid())
)
with check (
  bucket_id = 'profile-photos'
  and private.profile_photo_owner_id(name) = (select auth.uid())
);

drop policy if exists profile_photos_owner_delete on storage.objects;
create policy profile_photos_owner_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'profile-photos'
  and private.profile_photo_owner_id(name) = (select auth.uid())
);

drop policy if exists profile_photos_select on storage.objects;
create policy profile_photos_select
on storage.objects
for select
to authenticated
using (
  bucket_id = 'profile-photos'
  and private.can_read_profile_photo(private.profile_photo_owner_id(name))
);
