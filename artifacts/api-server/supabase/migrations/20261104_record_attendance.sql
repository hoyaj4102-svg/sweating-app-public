-- SWEATING / 20261104
-- Record class attendance (attended or no_show).
-- Runs after 20261102_attendance_reveal.sql. Idempotent.
-- Do not apply to production without a separate production review.
--
-- Who: the gym owner (one row in gym_owners; that person is the class host
-- for every class at the gym) or a profile with is_admin. Participants
-- cannot mark themselves. A host or admin who is also a participant may
-- record their own row, because the check is the role, not "someone else".
--
-- When: from scheduled_at inclusive until
-- scheduled_at + duration_minutes + 24 hours inclusive.
-- Before the start: attendance_too_early.
-- After that grace window: attendance_window_closed.
-- Only published or completed classes. Cancelled participant rows stay locked.
-- The supported values are attended and no_show. This does not cancel a seat
-- and does not move a row back to registered.
--
-- Writes go through record_attendance (security definer). A trigger rejects
-- every other attendance_status change, including service_role and a caller
-- who sets the transaction flag themselves. RLS denies direct updates for
-- anon and authenticated. gym_owners is not embedded in public gym rows.

create table if not exists public.gym_owners (
  gym_id uuid primary key references public.gyms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists gym_owners_user_idx
  on public.gym_owners(user_id);

alter table public.gym_owners enable row level security;

revoke all on table public.gym_owners from public, anon, authenticated;
grant select on table public.gym_owners to authenticated, service_role;
grant insert, update, delete on table public.gym_owners to service_role;

drop policy if exists "gym_owners_no_client_read" on public.gym_owners;
create policy "gym_owners_no_client_read"
on public.gym_owners
for select
to anon, authenticated
using (false);

revoke insert, update, delete on table public.class_participants from public, anon, authenticated;
grant select on table public.class_participants to authenticated;

drop policy if exists "participants_no_direct_update" on public.class_participants;
create policy "participants_no_direct_update"
on public.class_participants
for update
to anon, authenticated
using (false)
with check (false);

create or replace function public.protect_attendance_status()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  changing boolean;
begin
  if tg_op = 'INSERT' then
    changing := new.attendance_status is distinct from 'registered';
  elsif tg_op = 'UPDATE' then
    changing := new.attendance_status is distinct from old.attendance_status;
  else
    return new;
  end if;

  if not changing then
    return new;
  end if;

  -- record_attendance is security definer, so current_user is its owner
  -- (postgres or supabase_admin) and the flag is set in that same transaction.
  -- Authenticated and service_role stay blocked even if they set the flag.
  if current_setting('sweating.recording_attendance', true) = 'on'
     and current_user in ('postgres', 'supabase_admin') then
    return new;
  end if;

  raise exception 'attendance_change_forbidden'
    using errcode = '42501';
end;
$$;

revoke all on function public.protect_attendance_status() from public;
grant execute on function public.protect_attendance_status() to anon, authenticated, service_role;

drop trigger if exists class_participants_protect_attendance on public.class_participants;
create trigger class_participants_protect_attendance
before insert or update of attendance_status on public.class_participants
for each row
execute function public.protect_attendance_status();

create or replace function public.record_attendance(
  p_class_id uuid,
  p_user_id uuid,
  p_status text
)
returns public.class_participants
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  selected public.classes;
  owner_id uuid;
  participant public.class_participants;
  updated public.class_participants;
  scheduled_end timestamptz;
begin
  if actor is null then
    raise exception 'authentication_required';
  end if;

  if p_status is null or p_status not in ('attended', 'no_show') then
    raise exception 'attendance_status_invalid';
  end if;

  select * into selected
  from public.classes
  where id = p_class_id
  for update;

  if selected.id is null then
    raise exception 'class_not_found';
  end if;

  select gym_owners.user_id into owner_id
  from public.gym_owners
  where gym_owners.gym_id = selected.gym_id;

  if not public.is_admin() and owner_id is distinct from actor then
    raise exception 'attendance_forbidden';
  end if;

  if selected.status not in ('published', 'completed') then
    raise exception 'class_not_recordable';
  end if;

  scheduled_end := public.class_scheduled_end(selected.scheduled_at, selected.duration_minutes);

  if now() < selected.scheduled_at then
    raise exception 'attendance_too_early';
  end if;

  if now() > scheduled_end + interval '24 hours' then
    raise exception 'attendance_window_closed';
  end if;

  select * into participant
  from public.class_participants
  where class_id = p_class_id
    and user_id = p_user_id
  for update;

  if participant.id is null then
    raise exception 'participant_not_found';
  end if;

  if participant.attendance_status = 'cancelled' then
    raise exception 'participant_not_recordable';
  end if;

  if participant.attendance_status = p_status then
    return participant;
  end if;

  -- A like already names this person. Flipping attendance afterward would
  -- leave a match or a like for someone reveal no longer includes.
  -- The participant row lock blocks a concurrent like until this commits.
  if exists (
    select 1
    from public.likes
    where class_id = p_class_id
      and (from_user_id = p_user_id or to_user_id = p_user_id)
  ) then
    raise exception 'attendance_locked';
  end if;

  perform set_config('sweating.recording_attendance', 'on', true);

  update public.class_participants
  set attendance_status = p_status
  where id = participant.id
  returning * into updated;

  return updated;
end;
$$;

revoke all on function public.record_attendance(uuid, uuid, text) from public, anon;
grant execute on function public.record_attendance(uuid, uuid, text) to authenticated, service_role;

-- Production already has mark_attendance(p_class_id uuid, p_participant_id uuid,
-- p_status text) returns public.class_participants. It is security definer,
-- search_path empty, admin-only (admin_required), attended or no_show, and
-- allowed once scheduled_at is not in the future. That body updates
-- attendance_status directly. protect_attendance_status would raise
-- attendance_change_forbidden, because the old body never sets
-- sweating.recording_attendance.
-- Drop then create, with the same argument names and the same return type.
-- CREATE OR REPLACE cannot change a return type, and this function must stay
-- public.class_participants. p_participant_id is class_participants.id.
-- The replacement delegates to record_attendance. The rules become: admin or
-- gym host, attended or no_show, from scheduled_at through scheduled end +
-- 24 hours, and locked after a like. A non-admin now gets attendance_forbidden
-- from record_attendance rather than admin_required. A gym host can mark
-- attendance, which the production function did not allow.

drop function if exists public.mark_attendance(uuid, uuid, text);

create function public.mark_attendance(
  p_class_id uuid,
  p_participant_id uuid,
  p_status text
)
returns public.class_participants
language plpgsql
security definer
set search_path = public
as $$
declare
  participant_user uuid;
begin
  select class_participants.user_id
    into participant_user
  from public.class_participants
  where class_participants.id = p_participant_id
    and class_participants.class_id = p_class_id;

  if participant_user is null then
    raise exception 'participant_not_found';
  end if;

  return public.record_attendance(p_class_id, participant_user, p_status);
end;
$$;

revoke all on function public.mark_attendance(uuid, uuid, text) from public, anon;
grant execute on function public.mark_attendance(uuid, uuid, text) to authenticated, service_role;

-- Like/Match races:
-- 1. Both directions take one advisory lock on the sorted pair, so the second
--    transaction sees the first like and inserts the single match.
-- 2. Both participant rows are locked in user_id order before the like insert,
--    and again in the insert trigger. record_attendance locks that row too, so
--    attendance cannot change between the check and the insert.
-- Replacing like_participant here (after 20261102) keeps that migration intact.
-- Re-applying 20261102 restores the older function; this file must run after it.

create or replace function public.enforce_like_participants()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  from_status text;
  to_status text;
begin
  if not public.class_reveal_open(new.class_id) then
    raise exception 'class_not_completed';
  end if;

  -- Lock in user_id order so two likes that share a person cannot deadlock.
  perform 1
  from public.class_participants
  where class_id = new.class_id
    and user_id in (new.from_user_id, new.to_user_id)
  order by user_id
  for update;

  select attendance_status into from_status
  from public.class_participants
  where class_id = new.class_id
    and user_id = new.from_user_id;

  select attendance_status into to_status
  from public.class_participants
  where class_id = new.class_id
    and user_id = new.to_user_id;

  if from_status is distinct from 'attended' or to_status is distinct from 'attended' then
    raise exception 'participants_only';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_like_participants() from public;
grant execute on function public.enforce_like_participants() to anon, authenticated, service_role;

drop trigger if exists likes_enforce_participants on public.likes;
create trigger likes_enforce_participants
before insert on public.likes
for each row
execute function public.enforce_like_participants();

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
