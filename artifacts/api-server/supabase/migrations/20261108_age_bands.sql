-- SWEATING / 20261108 age-band matching MVP A
-- Do not apply to production without a separate a separate production review.
-- Do not deploy this file by itself. Preview verification is separate from prod.
--
-- Bands are 20-31 and 32-45. A member's band is
-- (extract year from now() at Asia/Seoul) - birth_year.
-- That is a birth-year cohort, not a verified 만 나이 and not an ID check.
--
-- profiles.age_preference:
--   same_band — likes only inside the member's own band
--   both      — either band, and only when the other person also allows it
-- Existing profiles default to both. birth_year stays nullable until the
-- member completes the profile in the app.
--
-- classes.age_band stays NULL on existing rows. NULL is not joinable through
-- the API. SQL join_class still accepts a NULL band so older seat tests and
-- any in-flight class keep their previous join rules. Once an admin sets
-- 20_31 or 32_45, join_class requires that band (admins may join either).
--
-- birth_year locks after the first non-null value for authenticated users.
-- Unlock, as postgres or service_role in the SQL editor:
--   update public.profiles set birth_year = 1992 where id = '<user uuid>';
-- To let the member save a new year:
--   update public.profiles set birth_year = null where id = '<user uuid>';
-- Re-applying 20261104 after this file removes the like age check.
-- Re-applying 20261107 after this file removes the join age check.
-- Keep this file last.

alter table public.profiles
  add column if not exists age_preference text;

alter table public.classes
  add column if not exists age_band text;

alter table public.profiles
  drop constraint if exists profiles_age_preference_check;
alter table public.profiles
  add constraint profiles_age_preference_check
  check (age_preference in ('same_band', 'both'));

alter table public.classes
  drop constraint if exists classes_age_band_check;
alter table public.classes
  add constraint classes_age_band_check
  check (age_band is null or age_band in ('20_31', '32_45'));

update public.profiles
set age_preference = 'both'
where age_preference is null;

alter table public.profiles
  alter column age_preference set default 'both';
alter table public.profiles
  alter column age_preference set not null;

comment on column public.profiles.age_preference is
  'same_band or both. Likes require both people to allow the pair.';
comment on column public.classes.age_band is
  'Recruiting band 20_31 or 32_45. NULL is hidden from non-admin join until an admin sets it.';

grant insert (age_preference) on table public.profiles to authenticated;
grant update (age_preference) on table public.profiles to authenticated;

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

create or replace function public.age_preferences_allow(
  p_birth_a integer,
  p_pref_a text,
  p_birth_b integer,
  p_pref_b text
) returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select
    public.profile_age_band(p_birth_a) is not null
    and public.profile_age_band(p_birth_b) is not null
    and p_pref_a in ('same_band', 'both')
    and p_pref_b in ('same_band', 'both')
    and (
      p_pref_a = 'both'
      or public.profile_age_band(p_birth_a) = public.profile_age_band(p_birth_b)
    )
    and (
      p_pref_b = 'both'
      or public.profile_age_band(p_birth_a) = public.profile_age_band(p_birth_b)
    );
$$;

revoke all on function public.age_preferences_allow(integer, text, integer, text) from public, anon;
grant execute on function public.age_preferences_allow(integer, text, integer, text) to authenticated, service_role;

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

drop trigger if exists profiles_protect_birth_year on public.profiles;
create trigger profiles_protect_birth_year
before insert or update of birth_year on public.profiles
for each row
execute function public.protect_profiles_birth_year();

-- Caller must be attended. Rows with a birth year are filtered by both
-- preferences. A viewer who has not saved a birth year still sees the
-- previous attended set so existing SQL fixtures keep working. The API
-- hides those rows until both sides have a band.
create or replace function public.revealed_participant_user_ids(
  p_class_id uuid,
  p_viewer_id uuid
)
returns table (user_id uuid)
language sql
stable
security invoker
set search_path = public
as $$
  select cp.user_id
  from public.class_participants cp
  left join public.profiles target on target.id = cp.user_id
  left join public.profiles viewer on viewer.id = p_viewer_id
  where public.class_reveal_open(p_class_id)
    and exists (
      select 1
      from public.class_participants self
      where self.class_id = p_class_id
        and self.user_id = p_viewer_id
        and self.attendance_status = 'attended'
    )
    and cp.class_id = p_class_id
    and cp.user_id <> p_viewer_id
    and cp.attendance_status = 'attended'
    and (
      viewer.birth_year is null
      or public.age_preferences_allow(
        viewer.birth_year,
        viewer.age_preference,
        target.birth_year,
        target.age_preference
      )
    );
$$;

revoke all on function public.revealed_participant_user_ids(uuid, uuid) from public, anon, authenticated;
grant execute on function public.revealed_participant_user_ids(uuid, uuid) to service_role;

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

create or replace function public.like_participant(
  p_class_id uuid,
  p_to_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  lower_user_id uuid;
  upper_user_id uuid;
  created_match public.matches;
  from_status text;
  to_status text;
  from_birth integer;
  to_birth integer;
  from_pref text;
  to_pref text;
begin
  if current_user_id is null then
    raise exception 'authentication_required';
  end if;

  if current_user_id = p_to_user_id then
    raise exception 'self_like_not_allowed';
  end if;

  if not public.class_reveal_open(p_class_id) then
    raise exception 'class_not_completed';
  end if;

  lower_user_id := least(current_user_id, p_to_user_id);
  upper_user_id := greatest(current_user_id, p_to_user_id);
  perform pg_advisory_xact_lock(
    hashtextextended(p_class_id::text || ':' || lower_user_id::text || ':' || upper_user_id::text, 0)
  );

  perform 1
  from public.class_participants
  where class_id = p_class_id
    and user_id in (current_user_id, p_to_user_id)
  order by user_id
  for update;

  select attendance_status into from_status
  from public.class_participants
  where class_id = p_class_id
    and user_id = current_user_id;

  select attendance_status into to_status
  from public.class_participants
  where class_id = p_class_id
    and user_id = p_to_user_id;

  if from_status is distinct from 'attended' or to_status is distinct from 'attended' then
    raise exception 'participants_only';
  end if;

  select birth_year, age_preference into from_birth, from_pref
  from public.profiles
  where id = current_user_id;

  select birth_year, age_preference into to_birth, to_pref
  from public.profiles
  where id = p_to_user_id;

  -- Legacy rows with no birth year keep the previous like path.
  -- The API rejects that pair before it calls this function.
  if from_birth is not null and to_birth is not null
     and not public.age_preferences_allow(from_birth, from_pref, to_birth, to_pref) then
    raise exception 'age_preference_mismatch';
  end if;

  insert into public.likes(class_id, from_user_id, to_user_id)
  values (p_class_id, current_user_id, p_to_user_id)
  on conflict (class_id, from_user_id, to_user_id) do nothing;

  if exists (
    select 1
    from public.likes
    where class_id = p_class_id
      and from_user_id = p_to_user_id
      and to_user_id = current_user_id
  ) then
    insert into public.matches(class_id, user_a_id, user_b_id)
    values (p_class_id, lower_user_id, upper_user_id)
    on conflict (class_id, user_a_id, user_b_id) do nothing
    returning * into created_match;

    if created_match.id is null then
      select *
      into created_match
      from public.matches
      where class_id = p_class_id
        and user_a_id = lower_user_id
        and user_b_id = upper_user_id;
    end if;
  end if;

  return jsonb_build_object(
    'liked', true,
    'matched', created_match.id is not null,
    'match_id', created_match.id
  );
end;
$$;

revoke all on function public.like_participant(uuid, uuid) from public, anon;
grant execute on function public.like_participant(uuid, uuid) to authenticated, service_role;
