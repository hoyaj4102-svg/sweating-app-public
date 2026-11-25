-- TEST ONLY. After 20261030 and 20261104.
-- Editable profile columns still insert and update. birth_date stays
-- writable, is_admin does not, and an upsert whose update list omits id
-- still succeeds. PUT /profiles/me inserts or updates without setting id;
-- that statement is asserted in 25_profile_save_statement.sql.
-- mark_attendance(p_class_id, p_participant_id, p_status) still records
-- attendance for an admin.
-- birth_year can be set once. A later change is birth_year_locked.
-- age_preference stays writable.
-- Do not run against a hosted project.

\set ON_ERROR_STOP on

insert into public.gyms (id, name, address, city)
values (
  '10000000-0000-4000-8000-000000000001',
  'baseline gym',
  'baseline',
  '예시시'
)
on conflict (id) do nothing;

insert into auth.users (id, email) values
  ('e1e1e1e1-e1e1-41e1-81e1-e1e1e1e1e1e1', 'mark-admin@example.com'),
  ('e2e2e2e2-e2e2-42e2-82e2-e2e2e2e2e2e2', 'mark-member@example.com'),
  ('e3e3e3e3-e3e3-43e3-83e3-e3e3e3e3e3e3', 'upsert@example.com');

insert into public.profiles (id, display_name, is_admin) values
  ('e1e1e1e1-e1e1-41e1-81e1-e1e1e1e1e1e1', 'Mark Admin', true),
  ('e2e2e2e2-e2e2-42e2-82e2-e2e2e2e2e2e2', 'Mark Member', false);

insert into public.classes (
  id, gym_id, title, sport_type, scheduled_at, duration_minutes, capacity, price, status
) values (
  '30000000-0000-4000-8000-0000000000b2',
  '10000000-0000-4000-8000-000000000001',
  'mark attendance class',
  '러닝',
  now() - interval '20 minutes',
  60,
  8,
  0,
  'published'
);

insert into public.class_participants (id, class_id, user_id) values (
  '40000000-0000-4000-8000-0000000000b2',
  '30000000-0000-4000-8000-0000000000b2',
  'e2e2e2e2-e2e2-42e2-82e2-e2e2e2e2e2e2'
);

\echo 'PASS: main profile upsert columns are granted and is_admin is not'

do $$
declare
  insert_columns text[] := array[
    'id',
    'display_name',
    'birth_year',
    'gender',
    'profile_photo_url',
    'sports',
    'interests',
    'bio',
    'birth_date',
    'age_preference'
  ];
  update_columns text[] := array[
    'display_name',
    'birth_year',
    'gender',
    'profile_photo_url',
    'sports',
    'interests',
    'bio',
    'birth_date',
    'age_preference'
  ];
  select_only text[] := array['is_admin', 'created_at', 'updated_at'];
  column_name text;
begin
  foreach column_name in array insert_columns loop
    if not has_column_privilege('authenticated', 'public.profiles', column_name, 'insert') then
      raise exception 'authenticated lacks INSERT on profiles.%', column_name;
    end if;
  end loop;

  foreach column_name in array update_columns loop
    if not has_column_privilege('authenticated', 'public.profiles', column_name, 'update') then
      raise exception 'authenticated lacks UPDATE on profiles.%', column_name;
    end if;
  end loop;

  if has_column_privilege('authenticated', 'public.profiles', 'id', 'update') then
    raise exception 'authenticated can UPDATE profiles.id';
  end if;

  foreach column_name in array select_only loop
    if not has_column_privilege('authenticated', 'public.profiles', column_name, 'select')
       or not has_column_privilege('anon', 'public.profiles', column_name, 'select') then
      raise exception 'missing SELECT on profiles.%', column_name;
    end if;
    if has_column_privilege('authenticated', 'public.profiles', column_name, 'insert')
       or has_column_privilege('authenticated', 'public.profiles', column_name, 'update') then
      raise exception 'authenticated can write profiles.%', column_name;
    end if;
  end loop;

  if has_column_privilege('anon', 'public.profiles', 'display_name', 'insert')
     or has_column_privilege('anon', 'public.profiles', 'birth_date', 'update') then
    raise exception 'anon can write profiles';
  end if;
end $$;

do $$
begin
  if to_regclass('public.user_consents') is null then
    return;
  end if;
  insert into public.user_consents (user_id, kind, version)
  select 'e3e3e3e3-e3e3-43e3-83e3-e3e3e3e3e3e3', kind, public.current_consent_version()
  from (values ('terms'), ('privacy'), ('overseas_transfer')) as required(kind)
  on conflict (user_id, kind, version) do nothing;
end $$;

\echo 'PASS: authenticated upsert without id in the update set still succeeds'

do $$
begin
  perform set_config('request.jwt.claim.sub', 'e3e3e3e3-e3e3-43e3-83e3-e3e3e3e3e3e3', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';

  insert into public.profiles (
    id,
    display_name,
    birth_year,
    gender,
    profile_photo_url,
    sports,
    interests,
    bio
  ) values (
    'e3e3e3e3-e3e3-43e3-83e3-e3e3e3e3e3e3',
    'Upsert Name',
    1994,
    'female',
    'https://example.test/profile.jpg',
    array['러닝']::text[],
    array['커피']::text[],
    'first bio'
  );

end $$;

\echo 'PASS: authenticated cannot change a saved birth_year'

do $$
begin
  perform set_config('request.jwt.claim.sub', 'e3e3e3e3-e3e3-43e3-83e3-e3e3e3e3e3e3', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  update public.profiles
  set birth_year = 1995
  where id = 'e3e3e3e3-e3e3-43e3-83e3-e3e3e3e3e3e3';
  raise exception 'birth year change succeeded';
exception
  when insufficient_privilege then
    if sqlerrm not like '%birth_year_locked%' then
      raise;
    end if;
end $$;

do $$
begin
  perform set_config('request.jwt.claim.sub', 'e3e3e3e3-e3e3-43e3-83e3-e3e3e3e3e3e3', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';

  insert into public.profiles (
    id,
    display_name,
    birth_year,
    gender,
    profile_photo_url,
    sports,
    interests,
    bio,
    age_preference
  ) values (
    'e3e3e3e3-e3e3-43e3-83e3-e3e3e3e3e3e3',
    'Upsert Name 2',
    1994,
    'male',
    'https://example.test/profile-2.jpg',
    array['복싱']::text[],
    array['영화']::text[],
    'second bio',
    'same_band'
  )
  on conflict (id) do update set
    display_name = excluded.display_name,
    birth_year = excluded.birth_year,
    gender = excluded.gender,
    profile_photo_url = excluded.profile_photo_url,
    sports = excluded.sports,
    interests = excluded.interests,
    bio = excluded.bio,
    age_preference = excluded.age_preference;
end $$;

do $$
declare
  saved public.profiles;
begin
  select * into saved
  from public.profiles
  where id = 'e3e3e3e3-e3e3-43e3-83e3-e3e3e3e3e3e3';

  if saved.display_name is distinct from 'Upsert Name 2'
     or saved.birth_year is distinct from 1994
     or saved.age_preference is distinct from 'same_band'
     or saved.gender is distinct from 'male'
     or saved.profile_photo_url is distinct from 'https://example.test/profile-2.jpg'
     or saved.sports is distinct from array['복싱']::text[]
     or saved.interests is distinct from array['영화']::text[]
     or saved.bio is distinct from 'second bio'
     or saved.is_admin is distinct from false then
    raise exception 'main profile upsert did not stick';
  end if;
end $$;

\echo 'PASS: authenticated can write birth_date and cannot write is_admin'

do $$
begin
  perform set_config('request.jwt.claim.sub', 'e3e3e3e3-e3e3-43e3-83e3-e3e3e3e3e3e3', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  update public.profiles
    set birth_date = date '1994-04-02'
    where id = 'e3e3e3e3-e3e3-43e3-83e3-e3e3e3e3e3e3';
end $$;

do $$
begin
  perform set_config('request.jwt.claim.sub', 'e3e3e3e3-e3e3-43e3-83e3-e3e3e3e3e3e3', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  update public.profiles
    set is_admin = true
    where id = 'e3e3e3e3-e3e3-43e3-83e3-e3e3e3e3e3e3';
  raise exception 'is_admin update succeeded';
exception
  when insufficient_privilege then
    if sqlerrm not like '%permission denied%' and sqlerrm not like '%is_admin_change_forbidden%' then
      raise;
    end if;
end $$;

do $$
declare
  saved_date date;
  saved_flag boolean;
begin
  select birth_date, is_admin into saved_date, saved_flag
  from public.profiles
  where id = 'e3e3e3e3-e3e3-43e3-83e3-e3e3e3e3e3e3';

  if saved_date is distinct from date '1994-04-02' or saved_flag is distinct from false then
    raise exception 'birth_date=% is_admin=%', saved_date, saved_flag;
  end if;
end $$;

\echo 'PROFILE_UPSERT_OK'

\echo 'PASS: mark_attendance still records attendance for an admin'

do $$
declare
  marked public.class_participants;
  body text;
begin
  select prosrc into body
  from pg_catalog.pg_proc
  where proname = 'mark_attendance';

  if body is null or position('record_attendance' in body) = 0 then
    raise exception 'mark_attendance was not replaced with the record_attendance delegate';
  end if;

  perform set_config('request.jwt.claim.sub', 'e1e1e1e1-e1e1-41e1-81e1-e1e1e1e1e1e1', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  marked := public.mark_attendance(
    '30000000-0000-4000-8000-0000000000b2',
    '40000000-0000-4000-8000-0000000000b2',
    'attended'
  );
  if marked.attendance_status is distinct from 'attended' then
    raise exception 'mark_attendance returned %', marked.attendance_status;
  end if;
exception
  when others then
    if sqlerrm like '%attendance_change_forbidden%' then
      raise exception 'mark_attendance is still blocked by the attendance trigger';
    end if;
    raise;
end $$;

\echo 'PASS: mark_attendance still refuses a non-admin'

do $$
begin
  perform set_config('request.jwt.claim.sub', 'e2e2e2e2-e2e2-42e2-82e2-e2e2e2e2e2e2', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  perform public.mark_attendance(
    '30000000-0000-4000-8000-0000000000b2',
    '40000000-0000-4000-8000-0000000000b2',
    'no_show'
  );
  raise exception 'non-admin mark_attendance succeeded';
exception
  when others then
    if sqlerrm not like '%attendance_forbidden%' then
      raise;
    end if;
end $$;

\echo 'MARK_ATTENDANCE_OK'
