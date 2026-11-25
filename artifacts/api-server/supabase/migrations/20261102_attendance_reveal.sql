-- RECONSTRUCTED from handoff description; verify against production before applying; do not run against prod without a separate production review
-- SWEATING / 20261102
-- Reveal participant profiles only after the scheduled end
-- (scheduled_at + duration_minutes) and only for attended participants.
-- Production can mark a class completed before that end. This file adds the
-- refusal on purpose: complete_class raises class_not_finished, and
-- prevent_early_class_completion blocks every role, including service_role.
-- complete_class still requires is_admin() and also refuses before that end.
-- Production's complete_class(p_class_id uuid) returns public.classes. This
-- replacement keeps that signature and return type so CREATE OR REPLACE applies.
-- Production's like_participant(p_class_id uuid, p_to_user_id uuid) already
-- returns jsonb and already requires attended participants after the scheduled
-- end (class_not_ready). Replacements in this file and in 20261104 keep
-- returns jsonb. 20261104 is the body that remains after a full pass.
-- A trigger blocks every role, including service_role, from marking a class
-- completed before the end. Reveal helpers check the end time again so a
-- forced status cannot open profiles early. Idempotent.

create or replace function public.class_scheduled_end(
  p_scheduled_at timestamptz,
  p_duration_minutes integer
)
returns timestamptz
language sql
immutable
as $$
  select p_scheduled_at + make_interval(mins => p_duration_minutes);
$$;

revoke all on function public.class_scheduled_end(timestamptz, integer) from public;
grant execute on function public.class_scheduled_end(timestamptz, integer) to anon, authenticated, service_role;

create or replace function public.class_reveal_open(p_class_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select exists (
    select 1
    from public.classes
    where id = p_class_id
      and status = 'completed'
      and now() >= public.class_scheduled_end(scheduled_at, duration_minutes)
  );
$$;

revoke all on function public.class_reveal_open(uuid) from public;
grant execute on function public.class_reveal_open(uuid) to authenticated, service_role;

-- Caller must be attended. Other rows are attended participants only.
-- Granted to service_role. The API uses the service role and applies the same
-- rule again in application code. Authenticated clients keep RLS on the table.
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
  where public.class_reveal_open(p_class_id)
    and exists (
      select 1
      from public.class_participants viewer
      where viewer.class_id = p_class_id
        and viewer.user_id = p_viewer_id
        and viewer.attendance_status = 'attended'
    )
    and cp.class_id = p_class_id
    and cp.user_id <> p_viewer_id
    and cp.attendance_status = 'attended';
$$;

revoke all on function public.revealed_participant_user_ids(uuid, uuid) from public, anon, authenticated;
grant execute on function public.revealed_participant_user_ids(uuid, uuid) to service_role;

create or replace function public.prevent_early_class_completion()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.status = 'completed'
     and now() < public.class_scheduled_end(new.scheduled_at, new.duration_minutes)
     and (
       tg_op = 'INSERT'
       or old.status is distinct from 'completed'
       or old.scheduled_at is distinct from new.scheduled_at
       or old.duration_minutes is distinct from new.duration_minutes
     )
  then
    raise exception 'class_not_finished'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function public.prevent_early_class_completion() from public;
grant execute on function public.prevent_early_class_completion() to anon, authenticated, service_role;

drop trigger if exists classes_prevent_early_completion on public.classes;
create trigger classes_prevent_early_completion
before insert or update of status, scheduled_at, duration_minutes on public.classes
for each row
execute function public.prevent_early_class_completion();

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
begin
  if current_user_id is null then
    raise exception 'authentication_required';
  end if;

  if current_user_id = p_to_user_id then
    raise exception 'self_like_not_allowed';
  end if;

  -- Same gate as profile reveal: completed and past the scheduled end.
  if not public.class_reveal_open(p_class_id) then
    raise exception 'class_not_completed';
  end if;

  if not exists (
    select 1
    from public.class_participants
    where class_id = p_class_id
      and user_id = current_user_id
      and attendance_status = 'attended'
  ) or not exists (
    select 1
    from public.class_participants
    where class_id = p_class_id
      and user_id = p_to_user_id
      and attendance_status = 'attended'
  ) then
    raise exception 'participants_only';
  end if;

  lower_user_id := least(current_user_id, p_to_user_id);
  upper_user_id := greatest(current_user_id, p_to_user_id);
  perform pg_advisory_xact_lock(
    hashtextextended(p_class_id::text || ':' || lower_user_id::text || ':' || upper_user_id::text, 0)
  );

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
