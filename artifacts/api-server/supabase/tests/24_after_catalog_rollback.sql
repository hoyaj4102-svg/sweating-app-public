-- TEST ONLY. After rolling back 20261107, 20261106, 20261104, 20261102, and
-- 20261030 on the catalog baseline. The baseline tables stay. The added
-- functions do not.
-- Do not run against a hosted project.

do $$
begin
  if to_regprocedure('public.record_attendance(uuid,uuid,text)') is not null then
    raise exception 'catalog rollback left record_attendance';
  end if;
  if to_regprocedure('public.mark_attendance(uuid,uuid,text)') is not null then
    raise exception 'catalog rollback left mark_attendance';
  end if;
  if to_regprocedure('public.complete_class(uuid)') is not null then
    raise exception 'catalog rollback left complete_class';
  end if;
  if to_regprocedure('public.like_participant(uuid,uuid)') is not null then
    raise exception 'catalog rollback left like_participant';
  end if;
  if to_regprocedure('public.protect_profiles_is_admin()') is not null then
    raise exception 'catalog rollback left protect_profiles_is_admin';
  end if;
  if to_regprocedure('public.cancel_class_seat(uuid,uuid)') is not null then
    raise exception 'catalog rollback left cancel_class_seat';
  end if;
  if to_regprocedure('public.class_seat_counts(uuid[],uuid)') is not null then
    raise exception 'catalog rollback left class_seat_counts';
  end if;
  if to_regclass('public.profiles') is null or to_regclass('public.class_participants') is null then
    raise exception 'catalog rollback removed baseline tables';
  end if;
  if to_regclass('public.announcements') is not null
     or to_regclass('public.owner_notice_acknowledgements') is not null
     or to_regprocedure('private.is_approved_gym_owner()') is not null
     or to_regprocedure('public.acknowledge_owner_principles(text)') is not null then
    raise exception 'catalog rollback left owner announcements';
  end if;

  if to_regprocedure('public.profile_age_band(integer)') is not null
     or to_regprocedure('public.protect_profiles_birth_year()') is not null
     or to_regprocedure('public.age_preferences_allow(integer,text,integer,text)') is not null then
    raise exception 'catalog rollback left an age band helper';
  end if;
end $$;
