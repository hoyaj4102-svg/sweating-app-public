-- Undo 20261115_profile_photo_without_age_gate.sql only.
-- Restores private.can_read_profile_photo from 20261112_profile_photo_storage.sql.
-- Does not change storage policies or other private functions.
-- Do not run this against a hosted project from CI.

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
