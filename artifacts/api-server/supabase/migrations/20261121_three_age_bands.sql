-- SWEATING / three age bands (tracked change, tracked change).
-- Do not apply this file to the hosted project until that migration is
-- separately approved. Local and CI databases only.
-- Preview builds do not run this file. It does not change like_participant.
--
-- Korean age is (extract year from now() at Asia/Seoul) - birth_year.
-- Signup stays 20 through 45. Bands are 20_25, 26_35, and 36_45.
--
-- profiles.age_preference is reused.
--   same_band — older preference off.
--   both      — older preference on: the one band directly above.
-- New profiles default to same_band.
-- Legacy rows whose value is still the old default both are set to
-- same_band once. A marker row records that cleanup. Re-running this
-- file does not clear a both chosen after the marker exists.
--
-- classes.age_band rewrite, applied to every leftover old value because
-- the new check would otherwise fail. No class id is named.
--   20_31 -> 20_25
--     The known row is one draft test class. 20-25 sits inside 20-31,
--     so the label narrows and does not add ages 26-35.
--   32_45 -> 36_45
--     The known row is one completed class. 36-45 sits inside 32-45,
--     so the label narrows and does not add ages 26-35.
-- NULL stays NULL. A NULL band allows every member, including admins.
--
-- join_class: same band passes. both also passes the next band up
-- (20_25 -> 26_35, 26_35 -> 36_45). Two bands up do not pass.
-- A lower band passes when the member's age is at most that band's
-- max plus 3 (20_25 through 28, 26_35 through 38). Admins still pass.

alter table public.profiles
  alter column age_preference set default 'same_band';

comment on column public.profiles.age_preference is
  'same_band: older preference off. both: one band above for class join. Not a like filter.';

-- 대표 승인(2026-11-22) 1회 정리.
-- 예전 기본값 both 로 남아 있던 회원(약 8명)만 same_band 로 바꾼다.
-- 반복해서 both 를 지우는 초기화가 아니다.
-- 마커가 있으면 이 UPDATE 는 다시 실행되지 않는다.
create table if not exists public.schema_change_markers (
  marker text primary key,
  applied_at timestamptz not null default now()
);

revoke all on table public.schema_change_markers from public, anon, authenticated;

create or replace function public.apply_20261121_age_preference_cleanup()
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if exists (
    select 1
    from public.schema_change_markers
    where marker = '20261121_age_preference_both_to_same_band'
  ) then
    return;
  end if;

  update public.profiles
  set age_preference = 'same_band'
  where age_preference = 'both';

  insert into public.schema_change_markers (marker)
  values ('20261121_age_preference_both_to_same_band');
end;
$$;

revoke all on function public.apply_20261121_age_preference_cleanup() from public, anon, authenticated;

select public.apply_20261121_age_preference_cleanup();

-- Drop the old check before rewriting values. 20_25 and 36_45 are rejected
-- while classes_age_band_check still allows only NULL, 20_31, and 32_45.
alter table public.classes
  drop constraint if exists classes_age_band_check;

update public.classes
set age_band = '20_25'
where age_band = '20_31';

update public.classes
set age_band = '36_45'
where age_band = '32_45';

alter table public.classes
  add constraint classes_age_band_check
  check (age_band is null or age_band in ('20_25', '26_35', '36_45'));

comment on column public.classes.age_band is
  'Recruiting band 20_25, 26_35, or 36_45. NULL allows every member.';

drop policy if exists "classes_owner_insert" on public.classes;
create policy "classes_owner_insert"
on public.classes
for insert
to authenticated
with check (
  public.is_gym_owner(gym_id)
  and status in ('draft', 'published')
  and age_band in ('20_25', '26_35', '36_45')
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
  and age_band in ('20_25', '26_35', '36_45')
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
    when (extract(year from (now() at time zone 'Asia/Seoul'))::integer - p_birth_year) between 20 and 25 then '20_25'
    when (extract(year from (now() at time zone 'Asia/Seoul'))::integer - p_birth_year) between 26 and 35 then '26_35'
    when (extract(year from (now() at time zone 'Asia/Seoul'))::integer - p_birth_year) between 36 and 45 then '36_45'
    else null
  end;
$$;

revoke all on function public.profile_age_band(integer) from public, anon;
grant execute on function public.profile_age_band(integer) to authenticated, service_role;

comment on function public.protect_profiles_birth_year() is
  'Signup ages are Seoul year minus birth_year, 20 through 45. The first non-null year then locks for authenticated users.';

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

create or replace function public.member_can_join_age_band(
  p_birth_year integer,
  p_age_preference text,
  p_class_band text
) returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select case
    when p_class_band is null then true
    when public.profile_age_band(p_birth_year) is null then false
    when public.profile_age_band(p_birth_year) = p_class_band then true
    when p_age_preference = 'both'
      and public.profile_age_band(p_birth_year) = '20_25'
      and p_class_band = '26_35' then true
    when p_age_preference = 'both'
      and public.profile_age_band(p_birth_year) = '26_35'
      and p_class_band = '36_45' then true
    when p_class_band = '20_25'
      and public.profile_age_band(p_birth_year) in ('26_35', '36_45')
      and (extract(year from (now() at time zone 'Asia/Seoul'))::integer - p_birth_year) <= 28 then true
    when p_class_band = '26_35'
      and public.profile_age_band(p_birth_year) = '36_45'
      and (extract(year from (now() at time zone 'Asia/Seoul'))::integer - p_birth_year) <= 38 then true
    else false
  end;
$$;

revoke all on function public.member_can_join_age_band(integer, text, text) from public, anon, authenticated;
grant execute on function public.member_can_join_age_band(integer, text, text) to service_role;

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
  caller_birth integer;
  caller_pref text;
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
    select p.is_admin, p.birth_year, p.age_preference
      into caller_admin, caller_birth, caller_pref
    from public.profiles p
    where p.id = p_user_id;

    if coalesce(caller_admin, false) = false
       and not public.member_can_join_age_band(caller_birth, caller_pref, selected_class.age_band) then
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
