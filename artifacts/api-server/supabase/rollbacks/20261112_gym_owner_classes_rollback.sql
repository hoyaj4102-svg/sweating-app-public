-- Undo 20261112_gym_owner_classes.sql only.
-- Restores the 20261102 complete_class body and the Sprint 02 class read policy.
-- Do not run this against a hosted project from CI.

drop trigger if exists classes_prevent_gym_move on public.classes;
drop function if exists public.prevent_class_gym_move();

drop policy if exists "participants_read_gym_owner" on public.class_participants;
drop policy if exists "classes_owner_insert" on public.classes;
drop policy if exists "classes_owner_update" on public.classes;
drop policy if exists "classes_read_authenticated" on public.classes;
drop policy if exists "classes_read_published" on public.classes;
drop policy if exists "gyms_admin_insert" on public.gyms;
drop policy if exists "gyms_admin_update" on public.gyms;

drop function if exists public.owner_class_roster(uuid);
drop function if exists public.lookup_user_id_by_email(text);
drop function if exists public.owned_gym_ids();
drop function if exists public.class_gym_id(uuid);
drop function if exists public.is_gym_owner(uuid);

create policy "classes_read_published" on public.classes
for select to anon, authenticated
using (
  status = 'published'
  or public.is_admin()
  or (
    status = 'completed'
    and exists (
      select 1
      from public.class_participants
      where class_id = public.classes.id
        and user_id = auth.uid()
        and attendance_status <> 'cancelled'
    )
  )
);

create or replace function public.complete_class(p_class_id uuid)
returns public.classes
language plpgsql
security definer
set search_path = public
as $$
declare
  selected public.classes;
  completed_class public.classes;
begin
  if not public.is_admin() then
    raise exception 'admin_required';
  end if;

  select * into selected
  from public.classes
  where id = p_class_id
  for update;

  if selected.id is null or selected.status = 'cancelled' then
    raise exception 'class_not_found';
  end if;

  if now() < public.class_scheduled_end(selected.scheduled_at, selected.duration_minutes) then
    raise exception 'class_not_finished';
  end if;

  update public.classes
  set status = 'completed'
  where id = p_class_id
    and status <> 'cancelled'
  returning * into completed_class;

  if completed_class.id is null then
    raise exception 'class_not_found';
  end if;

  return completed_class;
end;
$$;

revoke all on function public.complete_class(uuid) from public, anon;
grant execute on function public.complete_class(uuid) to authenticated, service_role;

-- Restore the 20261104 attendance return. Owners again receive the stored
-- payment_status from this function. The 20261104 rollback still drops it.
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
