-- SWEATING / 20261112 gym owner class operations.
-- Do not apply to a hosted or production database without a separate a separate production review.
-- Preview uses the production database. Do not run this file there.
--
-- Keeps one gym_owners row per gym, writable only by service_role.
-- An owner reads another participant only through owner_class_roster, which
-- returns id, user_id, attendance_status, and display_name. There is no
-- owner SELECT policy on class_participants, so a direct Data API read cannot
-- return another person's payment_status. record_attendance still returns the
-- table type, but a non-admin caller receives a null payment_status while the
-- stored value stays unchanged. Members still read their own row, including
-- payment_status. Admins still read every column.
-- A member, or the owner of a different gym, cannot.
-- Admin completion and the admin class routes stay in place.
--
-- Re-applying 20261102 after this file restores admin-only complete_class
-- and the older class read policy. Keep this file last.

-- class_gym_id existed only so an owner SELECT policy could see a class gym
-- without recursing through class_participants. That policy is not created:
-- it would expose payment_status. Drop both when re-applying this file.
drop policy if exists "participants_read_gym_owner" on public.class_participants;
drop function if exists public.class_gym_id(uuid);

create or replace function public.is_gym_owner(p_gym_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.gym_owners
    where gym_owners.gym_id = p_gym_id
      and gym_owners.user_id = auth.uid()
  );
$$;

revoke all on function public.is_gym_owner(uuid) from public, anon;
grant execute on function public.is_gym_owner(uuid) to authenticated, service_role;

create or replace function public.owned_gym_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select gym_owners.gym_id
  from public.gym_owners
  where gym_owners.user_id = auth.uid();
$$;

revoke all on function public.owned_gym_ids() from public, anon;
grant execute on function public.owned_gym_ids() to authenticated, service_role;

-- Service role only. The admin API looks up an existing account and does not
-- return the address. Authenticated and anon cannot execute this.
create or replace function public.lookup_user_id_by_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path = auth, public
as $$
  select users.id
  from auth.users
  where p_email is not null
    and users.email is not null
    and lower(users.email) = lower(btrim(p_email))
  limit 1;
$$;

revoke all on function public.lookup_user_id_by_email(text) from public, anon, authenticated;
grant execute on function public.lookup_user_id_by_email(text) to service_role;

create or replace function public.owner_class_roster(p_class_id uuid)
returns table (
  id uuid,
  user_id uuid,
  attendance_status text,
  display_name text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  selected_gym uuid;
begin
  if auth.uid() is null then
    raise exception 'authentication_required';
  end if;

  select classes.gym_id
    into selected_gym
  from public.classes
  where classes.id = p_class_id;

  if selected_gym is null then
    raise exception 'class_not_found';
  end if;

  if not public.is_admin() and not public.is_gym_owner(selected_gym) then
    raise exception 'owner_required';
  end if;

  return query
  select
    participants.id,
    participants.user_id,
    participants.attendance_status,
    profiles.display_name
  from public.class_participants as participants
  left join public.profiles on profiles.id = participants.user_id
  where participants.class_id = p_class_id
  order by participants.joined_at;
end;
$$;

revoke all on function public.owner_class_roster(uuid) from public, anon;
grant execute on function public.owner_class_roster(uuid) to authenticated, service_role;

create or replace function public.prevent_class_gym_move()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.gym_id is distinct from old.gym_id then
    if public.is_admin() then
      return new;
    end if;
    raise exception 'gym_move_forbidden'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.prevent_class_gym_move() from public;
grant execute on function public.prevent_class_gym_move() to anon, authenticated, service_role;

drop trigger if exists classes_prevent_gym_move on public.classes;
create trigger classes_prevent_gym_move
before update of gym_id on public.classes
for each row
execute function public.prevent_class_gym_move();

-- Owner or admin, and only after the scheduled end. A non-owner still gets
-- admin_required, including when the class is cancelled, so the previous
-- admin-only tests keep their error code.
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
  select * into selected
  from public.classes
  where id = p_class_id
  for update;

  if selected.id is null then
    raise exception 'class_not_found';
  end if;

  if not public.is_admin() and not public.is_gym_owner(selected.gym_id) then
    raise exception 'admin_required';
  end if;

  if selected.status = 'cancelled' then
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

revoke insert, update, delete on table public.gyms from anon;
grant insert, update on table public.gyms to authenticated;

drop policy if exists "gyms_admin_insert" on public.gyms;
create policy "gyms_admin_insert"
on public.gyms
for insert
to authenticated
with check (public.is_admin());

drop policy if exists "gyms_admin_update" on public.gyms;
create policy "gyms_admin_update"
on public.gyms
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

revoke insert, update, delete on table public.classes from anon;
grant insert, update on table public.classes to authenticated;

drop policy if exists "classes_read_published" on public.classes;
create policy "classes_read_published"
on public.classes
for select
to anon
using (status = 'published');

drop policy if exists "classes_read_authenticated" on public.classes;
create policy "classes_read_authenticated"
on public.classes
for select
to authenticated
using (
  status = 'published'
  or public.is_admin()
  or public.is_gym_owner(gym_id)
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

-- Do not add an owner SELECT policy on class_participants. Owner roster reads
-- go through owner_class_roster, which has no payment column.
drop policy if exists "participants_read_gym_owner" on public.class_participants;

-- Non-admins, including the gym owner, still record attendance. The stored
-- payment_status is not returned to them. Admins receive the stored value.
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
    if not public.is_admin() then
      participant.payment_status := null;
    end if;
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

  if not public.is_admin() then
    updated.payment_status := null;
  end if;

  return updated;
end;
$$;

revoke all on function public.record_attendance(uuid, uuid, text) from public, anon;
grant execute on function public.record_attendance(uuid, uuid, text) to authenticated, service_role;
