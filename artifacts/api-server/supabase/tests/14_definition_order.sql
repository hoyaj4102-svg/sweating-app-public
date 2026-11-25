-- After every migration file has been applied in lexical order, like_participant
-- keeps the 20261104 participant row lock and no longer reads age preference.
-- 20261102 also creates that function, without the participant row lock.
-- Re-applying 20261102 later would be a downgrade.

do $$
declare
  src text;
begin
  select prosrc into src
  from pg_catalog.pg_proc
  where proname = 'like_participant';

  if src is null or position('for update' in src) = 0 then
    raise exception 'like_participant is not the 20261104 definition';
  end if;

  if position('age_preferences_allow' in src) <> 0
     or position('age_preference_mismatch' in src) <> 0 then
    raise exception 'like_participant still enforces age preference';
  end if;

  if position('participants_only' in src) = 0
     or position('class_reveal_open' in src) = 0 then
    raise exception 'like_participant lost the attendance or reveal gate';
  end if;

  select prosrc into src
  from pg_catalog.pg_proc
  where proname = 'revealed_participant_user_ids';

  if src is null
     or position('age_preferences_allow' in src) <> 0
     or position('attendance_status' in src) = 0
     or position('class_reveal_open' in src) = 0 then
    raise exception 'revealed_participant_user_ids no longer matches the attendance reveal';
  end if;

  if to_regprocedure('public.age_preferences_allow(integer,text,integer,text)') is null
     or to_regprocedure('public.profile_age_band(integer)') is null then
    raise exception 'age helper used by class participation was dropped';
  end if;

  select prosrc into src
  from pg_catalog.pg_proc
  where proname = 'join_class';

  if src is null or position('age_band_mismatch' in src) = 0 then
    raise exception 'join_class is missing the age band check';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_trigger
    where tgname = 'likes_enforce_participants'
      and not tgisinternal
  ) then
    raise exception '20261104 like trigger is missing';
  end if;

  if to_regprocedure('public.record_attendance(uuid,uuid,text)') is null then
    raise exception 'record_attendance is missing';
  end if;

  select prosrc into src
  from pg_catalog.pg_proc
  where proname = 'mark_attendance';

  if src is null or position('record_attendance' in src) = 0 then
    raise exception 'mark_attendance does not delegate to record_attendance';
  end if;

  if pg_get_function_arguments('public.mark_attendance(uuid,uuid,text)'::regprocedure)
       is distinct from 'p_class_id uuid, p_participant_id uuid, p_status text' then
    raise exception 'mark_attendance signature drifted: %',
      pg_get_function_arguments('public.mark_attendance(uuid,uuid,text)'::regprocedure);
  end if;

  if pg_get_function_result('public.mark_attendance(uuid,uuid,text)'::regprocedure)
       not in ('class_participants', 'public.class_participants') then
    raise exception 'mark_attendance must keep returning class_participants';
  end if;

  if pg_get_function_arguments('public.complete_class(uuid)'::regprocedure)
       is distinct from 'p_class_id uuid'
     or pg_get_function_result('public.complete_class(uuid)'::regprocedure)
       not in ('classes', 'public.classes') then
    raise exception 'complete_class signature or return type drifted';
  end if;

  if pg_get_function_arguments('public.like_participant(uuid,uuid)'::regprocedure)
       is distinct from 'p_class_id uuid, p_to_user_id uuid'
     or pg_get_function_result('public.like_participant(uuid,uuid)'::regprocedure)
       is distinct from 'jsonb' then
    raise exception 'like_participant signature or return type drifted';
  end if;

  if pg_get_function_result('public.join_class(uuid,uuid)'::regprocedure)
       not in ('class_participants', 'public.class_participants') then
    raise exception 'join_class must keep returning class_participants';
  end if;

  if to_regprocedure('public.protect_profiles_is_admin()') is null then
    raise exception 'is_admin privilege trigger function is missing';
  end if;

  if to_regprocedure('public.class_reveal_open(uuid)') is null then
    raise exception 'class_reveal_open is missing';
  end if;
end $$;
