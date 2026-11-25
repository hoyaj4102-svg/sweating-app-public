-- Production structure from a read-only catalog read. No row data. Not a migration.
-- Do not run this against a hosted Supabase project.
-- PostgreSQL 17.6 catalog: columns, defaults, the one public trigger, column
-- grants, and the four function signatures below. list_migrations was empty.
--
-- Included because the functions and foreign keys need them, and the catalog
-- excerpt did not spell them out:
--   * public.gyms, from main's 20260905, so classes.gym_id has a target
--   * primary keys, foreign keys, and NOT NULL where the excerpt omitted them
--     but did not mark the column NULL (NULL was stated for birth_year, gender,
--     bio, birth_date, description, and image_url)
--   * public.is_admin() and public.set_updated_at(), which the catalog
--     functions and the profiles_set_updated_at trigger call
--   * execute grants, which were not in the excerpt; they match the API
--     (user JWT for mark/like/complete, service role for join_class)
-- class_participants RLS was not in the excerpt. This file does not enable
-- RLS. As of 2026-11-04 08:12 KST, production has the 20261106 revoke:
-- anon and authenticated have SELECT only. INSERT and UPDATE are not granted.

create extension if not exists pgcrypto;

create table if not exists public.gyms (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  address text not null,
  city text not null,
  latitude double precision,
  longitude double precision,
  image_url text,
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  birth_year integer,
  gender text,
  profile_photo_url text not null default '',
  sports text[] not null default '{}',
  interests text[] not null default '{}',
  bio text,
  is_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  birth_date date
);

create table if not exists public.classes (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id),
  title text not null,
  sport_type text not null,
  description text,
  scheduled_at timestamptz not null,
  duration_minutes integer not null,
  capacity integer not null,
  price integer not null default 0,
  image_url text,
  status text not null default 'draft',
  created_at timestamptz not null default now()
);

create table if not exists public.class_participants (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  payment_status text not null default 'free',
  attendance_status text not null default 'registered',
  joined_at timestamptz not null default now(),
  unique (class_id, user_id)
);

create table if not exists public.likes (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  from_user_id uuid not null references auth.users(id) on delete cascade,
  to_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (class_id, from_user_id, to_user_id)
);

create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  user_a_id uuid not null references auth.users(id) on delete cascade,
  user_b_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (class_id, user_a_id, user_b_id)
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row
execute function public.set_updated_at();

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and is_admin);
$$;

-- Non-admin failure is admin_required, matching mark_attendance. The catalog
-- note said this function requires is_admin() and did not name the exception.
create or replace function public.complete_class(p_class_id uuid)
returns public.classes
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated public.classes;
begin
  if not public.is_admin() then
    raise exception 'admin_required';
  end if;

  update public.classes
    set status = 'completed'
    where id = p_class_id
      and status <> 'cancelled'
    returning * into updated;

  if updated.id is null then
    raise exception 'class_not_found';
  end if;

  return updated;
end;
$$;

create or replace function public.join_class(p_class_id uuid, p_user_id uuid)
returns public.class_participants
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_class public.classes;
  created_participant public.class_participants;
  current_count integer;
begin
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

  if exists (
    select 1
    from public.class_participants
    where class_id = p_class_id
      and user_id = p_user_id
  ) then
    raise exception 'already_joined';
  end if;

  select count(*) into current_count
  from public.class_participants
  where class_id = p_class_id
    and attendance_status in ('registered', 'attended');

  if current_count >= selected_class.capacity then
    raise exception 'class_full';
  end if;

  insert into public.class_participants (class_id, user_id)
  values (p_class_id, p_user_id)
  returning * into created_participant;

  return created_participant;
end;
$$;

create or replace function public.like_participant(
  p_class_id uuid,
  p_to_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  lower_user_id uuid;
  upper_user_id uuid;
  selected_class public.classes;
  from_status text;
  to_status text;
  created_match public.matches;
begin
  if current_user_id is null then
    raise exception 'authentication_required';
  end if;

  if current_user_id = p_to_user_id then
    raise exception 'self_like_not_allowed';
  end if;

  perform 1
  from public.class_participants
  where class_id = p_class_id
    and user_id in (current_user_id, p_to_user_id)
  order by user_id
  for update;

  perform 1
  from public.classes
  where id = p_class_id
  for update;

  select * into selected_class
  from public.classes
  where id = p_class_id;

  if selected_class.id is null
     or selected_class.status = 'cancelled'
     or selected_class.scheduled_at + make_interval(mins => selected_class.duration_minutes) > now() then
    raise exception 'class_not_ready';
  end if;

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

  lower_user_id := least(current_user_id, p_to_user_id);
  upper_user_id := greatest(current_user_id, p_to_user_id);
  perform pg_advisory_xact_lock(
    hashtextextended(p_class_id::text || ':' || lower_user_id::text || ':' || upper_user_id::text, 0)
  );

  insert into public.likes (class_id, from_user_id, to_user_id)
  values (p_class_id, current_user_id, p_to_user_id)
  on conflict (class_id, from_user_id, to_user_id) do nothing;

  if exists (
    select 1
    from public.likes
    where class_id = p_class_id
      and from_user_id = p_to_user_id
      and to_user_id = current_user_id
  ) then
    insert into public.matches (class_id, user_a_id, user_b_id)
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

create or replace function public.mark_attendance(
  p_class_id uuid,
  p_participant_id uuid,
  p_status text
)
returns public.class_participants
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_participant public.class_participants;
  selected_class public.classes;
  updated public.class_participants;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'admin_required';
  end if;

  if p_status is null or p_status not in ('attended', 'no_show') then
    raise exception 'attendance_status_invalid';
  end if;

  select * into selected_participant
  from public.class_participants
  where id = p_participant_id
    and class_id = p_class_id
  for update;

  if selected_participant.id is null then
    raise exception 'participant_not_found';
  end if;

  if selected_participant.attendance_status = 'cancelled' then
    raise exception 'participant_cancelled';
  end if;

  select * into selected_class
  from public.classes
  where id = p_class_id
  for update;

  if selected_class.id is null then
    raise exception 'class_not_found';
  end if;

  if selected_class.status = 'cancelled' then
    raise exception 'class_cancelled';
  end if;

  if selected_class.scheduled_at > now() then
    raise exception 'class_not_started';
  end if;

  update public.class_participants
    set attendance_status = p_status
    where id = selected_participant.id
    returning * into updated;

  return updated;
end;
$$;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated, service_role;

revoke all on function public.complete_class(uuid) from public, anon;
grant execute on function public.complete_class(uuid) to authenticated, service_role;

revoke all on function public.join_class(uuid, uuid) from public, anon, authenticated;
grant execute on function public.join_class(uuid, uuid) to service_role;

revoke all on function public.like_participant(uuid, uuid) from public, anon;
grant execute on function public.like_participant(uuid, uuid) to authenticated, service_role;

revoke all on function public.mark_attendance(uuid, uuid, text) from public, anon;
grant execute on function public.mark_attendance(uuid, uuid, text) to authenticated, service_role;

-- Default privileges on the CI stub grant everything to anon and authenticated.
-- Replace that with the catalog grants.
revoke all on table public.profiles from public, anon, authenticated;
do $$
declare
  col text;
begin
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

revoke all on table public.class_participants from public, anon, authenticated;
grant select on table public.class_participants to anon, authenticated;

revoke all on table public.gyms, public.classes, public.likes, public.matches
  from public, anon, authenticated;

do $$
declare
  trigger_names text;
begin
  select string_agg(t.tgname, ', ' order by t.tgname)
    into trigger_names
  from pg_catalog.pg_trigger t
  join pg_catalog.pg_class c on c.oid = t.tgrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and not t.tgisinternal;

  if trigger_names is distinct from 'profiles_set_updated_at' then
    raise exception 'public triggers are [%], expected only profiles_set_updated_at', trigger_names;
  end if;
end $$;
