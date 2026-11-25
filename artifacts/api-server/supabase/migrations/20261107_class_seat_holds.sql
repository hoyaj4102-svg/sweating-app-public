-- SWEATING / 20261107
-- Keep the remaining-seat count aligned across join, cancel, and rejoin.
-- Runs after 20261104_record_attendance.sql. Idempotent.
-- Do not apply to production without a separate production review. CI uses a throwaway
-- Postgres only.
--
-- A bookable seat is attendance_status registered or attended. That is the
-- count already used by the catalog join_class. Cancelled and no_show do not
-- hold a seat. The public count is class_seat_counts, called with the service
-- role, so row level security cannot hide other members.
--
-- join_class reactivates one cancelled row for the same user instead of
-- inserting a second row. cancel_class_seat marks that row cancelled. A second
-- cancel returns the same row. attended and no_show stay put.
--
-- protect_attendance_status still rejects every other attendance change.
-- sweating.seat_hold is set only inside these two security definer functions.
-- It allows registered <-> cancelled, and only when current_user is the
-- function owner (postgres or supabase_admin). service_role cannot set the
-- flag and update the table itself. Re-applying 20261104 after this file
-- would restore the trigger body that rejects those two transitions.

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

  -- join_class and cancel_class_seat use the same owner check. The flag does
  -- not mark attended or no_show, and it does not insert a non-registered row.
  if current_setting('sweating.seat_hold', true) = 'on'
     and current_user in ('postgres', 'supabase_admin')
     and tg_op = 'UPDATE'
     and (
       (old.attendance_status = 'cancelled' and new.attendance_status = 'registered')
       or (old.attendance_status = 'registered' and new.attendance_status = 'cancelled')
     ) then
    return new;
  end if;

  raise exception 'attendance_change_forbidden'
    using errcode = '42501';
end;
$$;

revoke all on function public.protect_attendance_status() from public;
grant execute on function public.protect_attendance_status() to anon, authenticated, service_role;

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

create or replace function public.cancel_class_seat(p_class_id uuid, p_user_id uuid)
returns public.class_participants
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_class public.classes;
  participant public.class_participants;
  updated public.class_participants;
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

  select * into participant
  from public.class_participants
  where class_id = p_class_id
    and user_id = p_user_id
  for update;

  if participant.id is null then
    raise exception 'not_joined';
  end if;

  if participant.attendance_status = 'cancelled' then
    return participant;
  end if;

  if participant.attendance_status is distinct from 'registered' then
    raise exception 'seat_not_cancellable';
  end if;

  perform set_config('sweating.seat_hold', 'on', true);
  update public.class_participants
  set attendance_status = 'cancelled'
  where id = participant.id
  returning * into updated;
  perform set_config('sweating.seat_hold', 'off', true);
  return updated;
end;
$$;

revoke all on function public.cancel_class_seat(uuid, uuid) from public, anon, authenticated;
grant execute on function public.cancel_class_seat(uuid, uuid) to service_role;

create or replace function public.class_seat_counts(p_class_ids uuid[], p_user_id uuid)
returns table (class_id uuid, occupied integer, is_joined boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select
    requested.class_id,
    coalesce(counts.occupied, 0)::integer as occupied,
    coalesce(joined.is_joined, false) as is_joined
  from unnest(p_class_ids) as requested(class_id)
  left join (
    select participants.class_id, count(*)::integer as occupied
    from public.class_participants as participants
    where participants.attendance_status in ('registered', 'attended')
      and participants.class_id = any (p_class_ids)
    group by participants.class_id
  ) as counts on counts.class_id = requested.class_id
  left join (
    select participants.class_id, true as is_joined
    from public.class_participants as participants
    where participants.attendance_status <> 'cancelled'
      and participants.user_id = p_user_id
      and participants.class_id = any (p_class_ids)
  ) as joined on joined.class_id = requested.class_id;
$$;

revoke all on function public.class_seat_counts(uuid[], uuid) from public, anon, authenticated;
grant execute on function public.class_seat_counts(uuid[], uuid) to service_role;
