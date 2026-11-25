-- SWEATING / stop enforcing profiles.age_preference.
-- Replaces only revealed_participant_user_ids and like_participant.
-- The column, its check, its default, and existing values stay.
-- join_class, profile_age_band, the birth-year lock, attendance, grants,
-- search_path, and the mutual-like insert stay.
-- Do not apply this file to the hosted project until that migration is
-- separately approved. Local and CI databases only.

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
      from public.class_participants self
      where self.class_id = p_class_id
        and self.user_id = p_viewer_id
        and self.attendance_status = 'attended'
    )
    and cp.class_id = p_class_id
    and cp.user_id <> p_viewer_id
    and cp.attendance_status = 'attended';
$$;

revoke all on function public.revealed_participant_user_ids(uuid, uuid) from public, anon, authenticated;
grant execute on function public.revealed_participant_user_ids(uuid, uuid) to service_role;

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
