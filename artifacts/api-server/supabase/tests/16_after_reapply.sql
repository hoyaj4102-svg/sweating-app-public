-- Migrations must apply again on the database the rollback left behind.

do $$
begin
  if to_regclass('public.profiles') is null
     or to_regclass('public.gyms') is null
     or to_regclass('public.classes') is null
     or to_regclass('public.class_participants') is null
     or to_regclass('public.likes') is null
     or to_regclass('public.matches') is null
     or to_regclass('public.gym_owners') is null
  then
    raise exception 're-apply did not restore the app tables';
  end if;

  if to_regprocedure('public.record_attendance(uuid,uuid,text)') is null
     or to_regprocedure('public.mark_attendance(uuid,uuid,text)') is null
     or to_regprocedure('public.join_class(uuid,uuid)') is null
     or to_regprocedure('public.like_participant(uuid,uuid)') is null
     or to_regprocedure('public.cancel_class_seat(uuid,uuid)') is null
     or to_regprocedure('public.class_seat_counts(uuid[],uuid)') is null
  then
    raise exception 're-apply did not restore the app functions';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'birth_date'
  ) then
    raise exception 're-apply did not restore profiles.birth_date';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'age_preference'
  ) or not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'classes'
      and column_name = 'age_band'
  ) then
    raise exception 're-apply did not restore age band columns';
  end if;

  if to_regprocedure('public.profile_age_band(integer)') is null
     or to_regprocedure('public.protect_profiles_birth_year()') is null then
    raise exception 're-apply did not restore the birth year lock';
  end if;

  if to_regprocedure('public.is_gym_owner(uuid)') is null
     or to_regprocedure('public.owned_gym_ids()') is null
     or to_regprocedure('public.owner_class_roster(uuid)') is null
     or to_regprocedure('public.lookup_user_id_by_email(text)') is null
     or to_regprocedure('public.prevent_class_gym_move()') is null then
    raise exception 're-apply did not restore gym owner class functions';
  end if;

  if to_regprocedure('private.can_read_profile_photo(uuid)') is null
     or to_regprocedure('private.profile_photo_owner_id(text)') is null
     or to_regclass('storage.buckets') is null then
    raise exception 're-apply did not restore profile photo storage';
  end if;

  if to_regprocedure('private.is_approved_gym_owner()') is null
     or to_regprocedure('private.acknowledge_owner_principles(text)') is null
     or to_regprocedure('public.acknowledge_owner_principles(text)') is null
     or to_regclass('public.announcements') is null
     or to_regclass('public.owner_notice_acknowledgements') is null then
    raise exception 're-apply did not restore owner announcements';
  end if;

  if not exists (
    select 1
    from storage.buckets
    where id = 'profile-photos'
      and public = false
  ) then
    raise exception 're-apply did not restore the private profile photo bucket';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'gym_owners'
      and column_name = 'approved_at'
  ) then
    raise exception 're-apply did not restore gym_owners.approved_at';
  end if;

  if to_regclass('public.user_consents') is null
     or to_regclass('public.account_deletion_log') is null
     or to_regprocedure('public.record_own_consents(boolean,boolean,boolean)') is null
     or to_regprocedure('public.assert_own_account_deletable()') is null
     or to_regprocedure('public.delete_own_account()') is null then
    raise exception 're-apply did not restore consent or account deletion';
  end if;

  if to_regprocedure('public.delete_own_storage_objects(uuid)') is not null then
    raise exception 'account deletion still deletes storage rows in SQL';
  end if;
end $$;
