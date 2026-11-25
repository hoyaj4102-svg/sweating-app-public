-- Undo 20261121_three_age_bands.sql only.
-- Does not modify like_participant or revealed_participant_user_ids.
-- Do not run this against a hosted project from CI.
--
-- Class labels are reversed best-effort. Classes created after the forward
-- migration are relabeled the same way, because the old values are not stored:
--   20_25 -> 20_31
--   36_45 -> 32_45
--   26_35 -> NULL
-- NULL was hidden from the previous API join path.
-- 1회 정리(both → same_band)는 이전 age_preference 를 복원하지 않는다.
-- both 였던 행을 다시 both 로 되돌리지 않는다. 컬럼 기본값만 both 로 되돌린다.
-- 마커를 지우는 것은 값을 되돌리는 것이 아니다. 이 파일을 처음 적용할 때만
-- 정리가 다시 실행될 수 있다.

-- Drop the new check before writing 20_31 / 32_45. Those values are rejected
-- while the three-band check is still in place.
alter table public.classes
  drop constraint if exists classes_age_band_check;

update public.classes
set age_band = '20_31'
where age_band = '20_25';

update public.classes
set age_band = '32_45'
where age_band = '36_45';

update public.classes
set age_band = null
where age_band = '26_35';

alter table public.classes
  add constraint classes_age_band_check
  check (age_band is null or age_band in ('20_31', '32_45'));

comment on column public.classes.age_band is
  'Recruiting band 20_31 or 32_45. NULL is hidden from non-admin join until an admin sets it.';

alter table public.profiles
  alter column age_preference set default 'both';

comment on column public.profiles.age_preference is
  'same_band or both. Likes require both people to allow the pair.';

drop policy if exists "classes_owner_insert" on public.classes;
create policy "classes_owner_insert"
on public.classes
for insert
to authenticated
with check (
  public.is_gym_owner(gym_id)
  and status in ('draft', 'published')
  and age_band in ('20_31', '32_45')
);

drop policy if exists "classes_owner_update" on public.classes;
create policy "classes_owner_update"
on public.classes
for update
to authenticated
using (public.is_gym_owner(gym_id))
with check (
  public.is_gym_owner(gym_id)
  and status in ('draft', 'published', 'cancelled')
  and age_band in ('20_31', '32_45')
);

create or replace function public.profile_age_band(p_birth_year integer)
returns text
language sql
stable
security invoker
set search_path = public
as $$
  select case
    when p_birth_year is null then null
    when (extract(year from (now() at time zone 'Asia/Seoul'))::integer - p_birth_year) between 20 and 31 then '20_31'
    when (extract(year from (now() at time zone 'Asia/Seoul'))::integer - p_birth_year) between 32 and 45 then '32_45'
    else null
  end;
$$;

revoke all on function public.profile_age_band(integer) from public, anon;
grant execute on function public.profile_age_band(integer) to authenticated, service_role;

comment on function public.protect_profiles_birth_year() is null;

create or replace function public.protect_profiles_birth_year()
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
  if tg_op = 'INSERT' or old.birth_year is null then
    if new.birth_year is not null
       and not privileged
       and public.profile_age_band(new.birth_year) is null then
      raise exception 'birth_year_out_of_band'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if new.birth_year is not distinct from old.birth_year then
    return new;
  end if;

  if privileged then
    return new;
  end if;

  raise exception 'birth_year_locked'
    using errcode = '42501';
end;
$$;

revoke all on function public.protect_profiles_birth_year() from public;
grant execute on function public.protect_profiles_birth_year() to anon, authenticated, service_role;

drop function if exists public.member_can_join_age_band(integer, text, text);

create or replace function public.join_class(p_class_id uuid, p_user_id uuid)
returns public.class_participants
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_class public.classes;
  existing public.class_participants;
  created_participant public.class_participants;
  current_count integer;
  caller_admin boolean;
  caller_band text;
begin
  if p_user_id is null then
    raise exception 'authentication_required';
  end if;

  select * into selected_class
  from public.classes
  where id = p_class_id
  for update;

  if selected_class.id is null then
    raise exception 'class_not_found';
  end if;
  if selected_class.status <> 'published' then
    raise exception 'class_not_open';
  end if;
  if selected_class.scheduled_at <= now() then
    raise exception 'class_started';
  end if;

  if selected_class.age_band is not null then
    select p.is_admin, public.profile_age_band(p.birth_year)
      into caller_admin, caller_band
    from public.profiles p
    where p.id = p_user_id;

    if coalesce(caller_admin, false) = false and caller_band is distinct from selected_class.age_band then
      raise exception 'age_band_mismatch';
    end if;
  end if;

  select * into existing
  from public.class_participants
  where class_id = p_class_id
    and user_id = p_user_id
  for update;

  if existing.id is not null and existing.attendance_status is distinct from 'cancelled' then
    raise exception 'already_joined';
  end if;

  select count(*) into current_count
  from public.class_participants
  where class_id = p_class_id
    and attendance_status in ('registered', 'attended');
  if current_count >= selected_class.capacity then
    raise exception 'class_full';
  end if;

  if existing.id is not null then
    perform set_config('sweating.seat_hold', 'on', true);
    update public.class_participants
    set attendance_status = 'registered',
        joined_at = now()
    where id = existing.id
    returning * into created_participant;
    perform set_config('sweating.seat_hold', 'off', true);
    return created_participant;
  end if;

  insert into public.class_participants (class_id, user_id)
  values (p_class_id, p_user_id)
  returning * into created_participant;
  return created_participant;
end;
$$;

revoke all on function public.join_class(uuid, uuid) from public, anon, authenticated;
grant execute on function public.join_class(uuid, uuid) to service_role;

drop function if exists public.apply_20261121_age_preference_cleanup();
drop table if exists public.schema_change_markers;
