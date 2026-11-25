-- TEST ONLY. Three-band signup and join boundaries.
-- Do not run against a hosted project.

\set ON_ERROR_STOP on

\echo 'PASS three bands: check, helper, and like function stay in place'

do $$
declare
  definition text;
  like_src text;
begin
  select pg_get_constraintdef(oid) into definition
  from pg_constraint
  where conname = 'classes_age_band_check';

  if definition is null
     or position('20_25' in definition) = 0
     or position('26_35' in definition) = 0
     or position('36_45' in definition) = 0
     or position('20_31' in definition) <> 0
     or position('32_45' in definition) <> 0 then
    raise exception 'classes_age_band_check is not the three bands: %', definition;
  end if;

  if to_regprocedure('public.member_can_join_age_band(integer,text,text)') is null
     or to_regprocedure('public.profile_age_band(integer)') is null
     or to_regprocedure('public.protect_profiles_birth_year()') is null then
    raise exception 'three-band helpers are missing';
  end if;

  select prosrc into like_src
  from pg_catalog.pg_proc
  where proname = 'like_participant';

  if like_src is null
     or position('member_can_join_age_band' in like_src) <> 0
     or position('age_preferences_allow' in like_src) <> 0
     or position('age_preference_mismatch' in like_src) <> 0 then
    raise exception 'like_participant was given an age block';
  end if;
end $$;

\echo 'PASS three bands: profile_age_band boundaries'

do $$
declare
  seoul_year integer := extract(year from (now() at time zone 'Asia/Seoul'))::integer;
  age integer;
  seen text;
  expected text;
begin
  foreach age in array array[19, 20, 25, 26, 28, 29, 35, 36, 38, 39, 45, 46]
  loop
    seen := public.profile_age_band(seoul_year - age);
    expected := case
      when age between 20 and 25 then '20_25'
      when age between 26 and 35 then '26_35'
      when age between 36 and 45 then '36_45'
      else null
    end;
    if seen is distinct from expected then
      raise exception 'age % band % expected %', age, seen, expected;
    end if;
  end loop;
end $$;

\echo 'PASS three bands: join matrix'

do $$
declare
  seoul_year integer := extract(year from (now() at time zone 'Asia/Seoul'))::integer;
  sample record;
  seen boolean;
begin
  for sample in
    select *
    from (values
      (20, 'same_band', '20_25', true),
      (20, 'same_band', '26_35', false),
      (20, 'both', '26_35', true),
      (20, 'both', '36_45', false),
      (25, 'same_band', '20_25', true),
      (25, 'same_band', '26_35', false),
      (25, 'both', '26_35', true),
      (25, 'both', '36_45', false),
      (26, 'same_band', '20_25', true),
      (26, 'same_band', '26_35', true),
      (26, 'same_band', '36_45', false),
      (26, 'both', '36_45', true),
      (28, 'same_band', '20_25', true),
      (29, 'same_band', '20_25', false),
      (29, 'both', '36_45', true),
      (35, 'same_band', '26_35', true),
      (35, 'same_band', '36_45', false),
      (35, 'both', '36_45', true),
      (35, 'both', '20_25', false),
      (36, 'same_band', '26_35', true),
      (36, 'same_band', '36_45', true),
      (36, 'both', '20_25', false),
      (36, 'both', '36_45', true),
      (38, 'same_band', '26_35', true),
      (38, 'same_band', '20_25', false),
      (39, 'same_band', '26_35', false),
      (39, 'both', '26_35', false),
      (45, 'both', '36_45', true),
      (45, 'both', '26_35', false),
      (46, 'both', '36_45', false),
      (46, 'both', null, true),
      (20, 'same_band', null, true)
    ) as rows(age, pref, band, allowed)
  loop
    seen := public.member_can_join_age_band(seoul_year - sample.age, sample.pref, sample.band);
    if seen is distinct from sample.allowed then
      raise exception 'age % pref % band % saw % expected %',
        sample.age, sample.pref, sample.band, seen, sample.allowed;
    end if;
  end loop;
end $$;

\echo 'PASS three bands: old class labels are rejected and null is allowed'

insert into public.gyms (id, name, address, city)
values ('10000000-0000-4000-8000-0000000000b3', 'Three Band Gym', 'Busan', 'Busan')
on conflict (id) do nothing;

do $$
declare
  preference_default text;
begin
  select column_default into preference_default
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'profiles'
    and column_name = 'age_preference';
  if preference_default not like '%same_band%' then
    raise exception 'age_preference default is %', preference_default;
  end if;

  insert into public.classes (
    id, gym_id, title, sport_type, scheduled_at, duration_minutes, capacity, price, status, age_band
  ) values (
    '31000000-0000-4000-8000-000000000031',
    '10000000-0000-4000-8000-0000000000b3',
    'old band',
    '러닝',
    now() + interval '4 days',
    60,
    8,
    0,
    'draft',
    '20_31'
  );
  raise exception 'old band was stored';
exception
  when check_violation then
    null;
end $$;

insert into public.classes (
  id, gym_id, title, sport_type, scheduled_at, duration_minutes, capacity, price, status, age_band
) values
  ('31000000-0000-4000-8000-000000000025', '10000000-0000-4000-8000-0000000000b3', 'band 20', '러닝', now() + interval '4 days', 60, 8, 0, 'published', '20_25'),
  ('31000000-0000-4000-8000-000000000035', '10000000-0000-4000-8000-0000000000b3', 'band 26', '러닝', now() + interval '4 days', 60, 8, 0, 'published', '26_35'),
  ('31000000-0000-4000-8000-000000000045', '10000000-0000-4000-8000-0000000000b3', 'band 36', '러닝', now() + interval '4 days', 60, 8, 0, 'published', '36_45'),
  ('31000000-0000-4000-8000-0000000000aa', '10000000-0000-4000-8000-0000000000b3', 'open band', '러닝', now() + interval '4 days', 60, 8, 0, 'published', null);

insert into auth.users (id, email) values
  ('a3a3a3a3-a3a3-43a3-83a3-a3a3a3a3a3a3', 'band-20@example.com'),
  ('b3b3b3b3-b3b3-43b3-83b3-b3b3b3b3b3b3', 'band-28@example.com'),
  ('f4f4f4f4-f4f4-44f4-84f4-f4f4f4f4f4f4', 'band-admin-3@example.com'),
  ('d3d3d3d3-d3d3-43d3-83d3-d3d3d3d3d3d3', 'band-46@example.com'),
  ('29000000-0000-4000-8000-000000000001', 'band-signup@example.com'),
  ('a4a4a4a4-a4a4-44a4-84a4-a4a4a4a4a4a4', 'band-29@example.com'),
  ('b4b4b4b4-b4b4-44b4-84b4-b4b4b4b4b4b4', 'band-38@example.com'),
  ('c4c4c4c4-c4c4-44c4-84c4-c4c4c4c4c4c4', 'band-19@example.com'),
  ('f3f3f3f3-f3f3-43f3-83f3-f3f3f3f3f3f3', 'band-too-old@example.com')
on conflict (id) do nothing;

do $$
declare
  seoul_year integer := extract(year from (now() at time zone 'Asia/Seoul'))::integer;
begin
  insert into public.profiles (id, display_name, birth_year, age_preference, is_admin)
  values
    ('a3a3a3a3-a3a3-43a3-83a3-a3a3a3a3a3a3', 'Age Twenty', seoul_year - 20, 'same_band', false),
    ('b3b3b3b3-b3b3-43b3-83b3-b3b3b3b3b3b3', 'Age Twenty Eight', seoul_year - 28, 'same_band', false),
    ('f4f4f4f4-f4f4-44f4-84f4-f4f4f4f4f4f4', 'Band Admin', seoul_year - 20, 'same_band', true),
    ('d3d3d3d3-d3d3-43d3-83d3-d3d3d3d3d3d3', 'Age Forty Six', seoul_year - 46, 'both', false),
    ('a4a4a4a4-a4a4-44a4-84a4-a4a4a4a4a4a4', 'Age Twenty Nine', seoul_year - 29, 'same_band', false),
    ('b4b4b4b4-b4b4-44b4-84b4-b4b4b4b4b4b4', 'Age Thirty Eight', seoul_year - 38, 'same_band', false);
end $$;

\echo 'PASS three bands: join_class enforces the matrix and the admin exception'

do $$
declare
  joined public.class_participants;
begin
  execute 'set local role service_role';
  joined := public.join_class(
    '31000000-0000-4000-8000-000000000025',
    'a3a3a3a3-a3a3-43a3-83a3-a3a3a3a3a3a3'
  );
  if joined.attendance_status is distinct from 'registered' then
    raise exception 'age 20 same band status %', joined.attendance_status;
  end if;

  begin
    perform public.join_class(
      '31000000-0000-4000-8000-000000000035',
      'a3a3a3a3-a3a3-43a3-83a3-a3a3a3a3a3a3'
    );
    raise exception 'older preference off joined one band up';
  exception
    when others then
      if sqlerrm like '%older preference off joined one band up%' or sqlerrm not like '%age_band_mismatch%' then
        raise;
      end if;
  end;

  update public.profiles
  set age_preference = 'both'
  where id = 'a3a3a3a3-a3a3-43a3-83a3-a3a3a3a3a3a3';

  joined := public.join_class(
    '31000000-0000-4000-8000-000000000035',
    'a3a3a3a3-a3a3-43a3-83a3-a3a3a3a3a3a3'
  );
  if joined.user_id is distinct from 'a3a3a3a3-a3a3-43a3-83a3-a3a3a3a3a3a3' then
    raise exception 'older preference did not open the next band';
  end if;

  begin
    perform public.join_class(
      '31000000-0000-4000-8000-000000000045',
      'a3a3a3a3-a3a3-43a3-83a3-a3a3a3a3a3a3'
    );
    raise exception 'two bands up joined';
  exception
    when others then
      if sqlerrm like '%two bands up joined%' or sqlerrm not like '%age_band_mismatch%' then
        raise;
      end if;
  end;

  joined := public.join_class(
    '31000000-0000-4000-8000-000000000045',
    'f4f4f4f4-f4f4-44f4-84f4-f4f4f4f4f4f4'
  );
  if joined.user_id is distinct from 'f4f4f4f4-f4f4-44f4-84f4-f4f4f4f4f4f4' then
    raise exception 'admin exception failed';
  end if;

  joined := public.join_class(
    '31000000-0000-4000-8000-000000000025',
    'b3b3b3b3-b3b3-43b3-83b3-b3b3b3b3b3b3'
  );
  if joined.attendance_status is distinct from 'registered' then
    raise exception 'age 28 lower band status %', joined.attendance_status;
  end if;

  begin
    perform public.join_class(
      '31000000-0000-4000-8000-000000000025',
      'a4a4a4a4-a4a4-44a4-84a4-a4a4a4a4a4a4'
    );
    raise exception 'age 29 joined 20_25';
  exception
    when others then
      if sqlerrm like '%age 29 joined%' or sqlerrm not like '%age_band_mismatch%' then
        raise;
      end if;
  end;

  joined := public.join_class(
    '31000000-0000-4000-8000-000000000035',
    'b4b4b4b4-b4b4-44b4-84b4-b4b4b4b4b4b4'
  );
  if joined.attendance_status is distinct from 'registered' then
    raise exception 'age 38 lower band status %', joined.attendance_status;
  end if;

  update public.profiles
  set birth_year = extract(year from (now() at time zone 'Asia/Seoul'))::integer - 39,
      age_preference = 'both'
  where id = 'b3b3b3b3-b3b3-43b3-83b3-b3b3b3b3b3b3';

  begin
    perform public.join_class(
      '31000000-0000-4000-8000-000000000035',
      'b3b3b3b3-b3b3-43b3-83b3-b3b3b3b3b3b3'
    );
    raise exception 'age 39 joined 26_35';
  exception
    when others then
      if sqlerrm like '%age 39 joined%' or sqlerrm not like '%age_band_mismatch%' then
        raise;
      end if;
  end;

  joined := public.join_class(
    '31000000-0000-4000-8000-0000000000aa',
    'd3d3d3d3-d3d3-43d3-83d3-d3d3d3d3d3d3'
  );
  if joined.attendance_status is distinct from 'registered' then
    raise exception 'null band refused age 46';
  end if;

  begin
    perform public.join_class(
      '31000000-0000-4000-8000-000000000045',
      'd3d3d3d3-d3d3-43d3-83d3-d3d3d3d3d3d3'
    );
    raise exception 'age 46 joined a band';
  exception
    when others then
      if sqlerrm like '%age 46 joined a band%' or sqlerrm not like '%age_band_mismatch%' then
        raise;
      end if;
  end;
end $$;

insert into public.user_consents (user_id, kind, version)
select member_id, kind, public.current_consent_version()
from (values
  ('29000000-0000-4000-8000-000000000001'::uuid),
  ('c4c4c4c4-c4c4-44c4-84c4-c4c4c4c4c4c4'::uuid),
  ('f3f3f3f3-f3f3-43f3-83f3-f3f3f3f3f3f3'::uuid)
) as members(member_id)
cross join (values ('terms'), ('privacy'), ('overseas_transfer')) as required(kind)
on conflict (user_id, kind, version) do nothing;

\echo 'PASS three bands: signup allows 20 and 45 and rejects 19 and 46'

do $$
declare
  seoul_year integer := extract(year from (now() at time zone 'Asia/Seoul'))::integer;
begin
  perform set_config('request.jwt.claim.sub', '29000000-0000-4000-8000-000000000001', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  insert into public.profiles (id, display_name, birth_year, age_preference)
  values ('29000000-0000-4000-8000-000000000001', 'Signup Twenty', seoul_year - 20, 'same_band');
  if public.profile_age_band(seoul_year - 20) is distinct from '20_25' then
    raise exception 'age 20 did not land in 20_25';
  end if;
end $$;

do $$
declare
  seoul_year integer := extract(year from (now() at time zone 'Asia/Seoul'))::integer;
begin
  execute 'set local role service_role';
  update public.profiles
  set birth_year = null
  where id = '29000000-0000-4000-8000-000000000001';
  execute 'set local role authenticated';
  update public.profiles
  set birth_year = seoul_year - 45
  where id = '29000000-0000-4000-8000-000000000001';
  if public.profile_age_band(seoul_year - 45) is distinct from '36_45' then
    raise exception 'age 45 did not land in 36_45';
  end if;
end $$;

do $$
declare
  seoul_year integer := extract(year from (now() at time zone 'Asia/Seoul'))::integer;
begin
  perform set_config('request.jwt.claim.sub', 'c4c4c4c4-c4c4-44c4-84c4-c4c4c4c4c4c4', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  insert into public.profiles (id, display_name, birth_year)
  values ('c4c4c4c4-c4c4-44c4-84c4-c4c4c4c4c4c4', 'Signup Nineteen', seoul_year - 19);
  raise exception 'age 19 signup was stored';
exception
  when insufficient_privilege then
    if sqlerrm not like '%birth_year_out_of_band%' then
      raise;
    end if;
end $$;

do $$
declare
  seoul_year integer := extract(year from (now() at time zone 'Asia/Seoul'))::integer;
begin
  insert into auth.users (id, email)
  values ('f3f3f3f3-f3f3-43f3-83f3-f3f3f3f3f3f3', 'band-too-old@example.com')
  on conflict (id) do nothing;
  perform set_config('request.jwt.claim.sub', 'f3f3f3f3-f3f3-43f3-83f3-f3f3f3f3f3f3', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  insert into public.profiles (id, display_name, birth_year)
  values ('f3f3f3f3-f3f3-43f3-83f3-f3f3f3f3f3f3', 'Signup Forty Six', seoul_year - 46);
  raise exception 'age 46 signup was stored';
exception
  when insufficient_privilege then
    if sqlerrm not like '%birth_year_out_of_band%' then
      raise;
    end if;
end $$;

\echo 'PASS three bands: legacy both cleanup runs once and a later both survives'

do $$
declare
  seoul_year integer := extract(year from (now() at time zone 'Asia/Seoul'))::integer;
  seen text;
  member uuid := '29000000-0000-4000-8000-0000000000b1';
begin
  if to_regprocedure('public.apply_20261121_age_preference_cleanup()') is null then
    raise exception 'age preference cleanup function is missing';
  end if;

  if not exists (
    select 1
    from public.schema_change_markers
    where marker = '20261121_age_preference_both_to_same_band'
  ) then
    raise exception 'cleanup marker is missing after the migration';
  end if;

  insert into auth.users (id, email)
  values (member, 'band-later-both@example.com')
  on conflict (id) do nothing;

  insert into public.profiles (id, display_name, birth_year, age_preference, is_admin)
  values (member, 'Later Both', seoul_year - 30, 'both', false);

  perform public.apply_20261121_age_preference_cleanup();

  select age_preference into seen
  from public.profiles
  where id = member;
  if seen is distinct from 'both' then
    raise exception 're-run cleared a later both, saw %', seen;
  end if;

  delete from public.schema_change_markers
  where marker = '20261121_age_preference_both_to_same_band';

  perform public.apply_20261121_age_preference_cleanup();

  select age_preference into seen
  from public.profiles
  where id = member;
  if seen is distinct from 'same_band' then
    raise exception 'one-time cleanup left %', seen;
  end if;

  if not exists (
    select 1
    from public.schema_change_markers
    where marker = '20261121_age_preference_both_to_same_band'
  ) then
    raise exception 'cleanup did not write the marker';
  end if;

  update public.profiles
  set age_preference = 'both'
  where id = member;

  perform public.apply_20261121_age_preference_cleanup();

  select age_preference into seen
  from public.profiles
  where id = member;
  if seen is distinct from 'both' then
    raise exception 'second re-run cleared a later both, saw %', seen;
  end if;
end $$;

\echo 'PASS three bands: remap runs only after the old check is dropped'

-- Restore the pre-migration check, store the two legacy labels, then apply
-- this migration file. The old check must still be present when those rows
-- are inserted, or this does not reproduce the failed production apply.
\ir ../rollbacks/20261121_three_age_bands_rollback.sql

insert into public.classes (
  id, gym_id, title, sport_type, scheduled_at, duration_minutes, capacity, price, status, age_band
) values
  (
    '32000000-0000-4000-8000-000000000031',
    '10000000-0000-4000-8000-0000000000b3',
    'legacy draft',
    '러닝',
    now() + interval '5 days',
    60,
    8,
    0,
    'draft',
    '20_31'
  ),
  (
    '32000000-0000-4000-8000-000000000045',
    '10000000-0000-4000-8000-0000000000b3',
    'legacy completed',
    '러닝',
    now() - interval '3 days',
    60,
    8,
    0,
    'completed',
    '32_45'
  );

\ir ../migrations/20261121_three_age_bands.sql

do $$
declare
  draft_band text;
  completed_band text;
  definition text;
begin
  select age_band into draft_band
  from public.classes
  where id = '32000000-0000-4000-8000-000000000031';
  select age_band into completed_band
  from public.classes
  where id = '32000000-0000-4000-8000-000000000045';
  if draft_band is distinct from '20_25' or completed_band is distinct from '36_45' then
    raise exception 'remap left draft % completed %', draft_band, completed_band;
  end if;

  select pg_get_constraintdef(oid) into definition
  from pg_constraint
  where conname = 'classes_age_band_check';
  if definition is null
     or position('20_25' in definition) = 0
     or position('26_35' in definition) = 0
     or position('36_45' in definition) = 0
     or position('20_31' in definition) <> 0
     or position('32_45' in definition) <> 0 then
    raise exception 'check after remap is %', definition;
  end if;
end $$;

\echo 'THREE_AGE_BANDS_OK'
