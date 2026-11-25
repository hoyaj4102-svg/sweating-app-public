-- Undo 20261107_class_seat_holds.sql only.
-- Restores the catalog join_class body (registered and attended hold a seat,
-- any existing row is already_joined, search_path empty) and the 20261104
-- attendance trigger. Drops cancel_class_seat and class_seat_counts.
-- Do not run this against a hosted project from CI.

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

revoke all on function public.join_class(uuid, uuid) from public, anon, authenticated;
grant execute on function public.join_class(uuid, uuid) to service_role;

drop function if exists public.cancel_class_seat(uuid, uuid);
drop function if exists public.class_seat_counts(uuid[], uuid);
