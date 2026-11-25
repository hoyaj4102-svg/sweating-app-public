-- TEST ONLY. Age band join, reveal, like, and the birth_year lock.
-- Do not run against a hosted project.

\set ON_ERROR_STOP on

\echo 'PASS age bands: setup'

insert into auth.users (id, email) values
  ('a8a8a8a8-a8a8-48a8-88a8-a8a8a8a8a8a8', 'band-young@example.com'),
  ('b8b8b8b8-b8b8-48b8-88b8-b8b8b8b8b8b8', 'band-older@example.com'),
  ('c8c8c8c8-c8c8-48c8-88c8-c8c8c8c8c8c8', 'band-admin@example.com'),
  ('d8d8d8d8-d8d8-48d8-88d8-d8d8d8d8d8d8', 'band-child@example.com')
on conflict (id) do nothing;

insert into public.gyms (id, name, address, city)
values ('10000000-0000-4000-8000-0000000000a8', 'Age Gym', 'Busan', 'Busan')
on conflict (id) do nothing;

do $$
declare
  seoul_year integer := extract(year from (now() at time zone 'Asia/Seoul'))::integer;
  young_year integer := seoul_year - 25;
  older_year integer := seoul_year - 36;
begin
  insert into public.profiles (id, display_name, birth_year, age_preference, is_admin)
  values
    ('a8a8a8a8-a8a8-48a8-88a8-a8a8a8a8a8a8', 'Young', young_year, 'same_band', false),
    ('b8b8b8b8-b8b8-48b8-88b8-b8b8b8b8b8b8', 'Older', older_year, 'both', false),
    ('c8c8c8c8-c8c8-48c8-88c8-c8c8c8c8c8c8', 'Band Admin', older_year, 'both', true);
end $$;

\echo 'PASS age bands: out of range birth year is rejected'

do $$
declare
  child_year integer := extract(year from (now() at time zone 'Asia/Seoul'))::integer - 16;
begin
  perform set_config('request.jwt.claim.sub', 'd8d8d8d8-d8d8-48d8-88d8-d8d8d8d8d8d8', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  insert into public.profiles (id, display_name, birth_year)
  values ('d8d8d8d8-d8d8-48d8-88d8-d8d8d8d8d8d8', 'Too Young', child_year);
  raise exception 'out of band birth year was stored';
exception
  when insufficient_privilege then
    if sqlerrm not like '%birth_year_out_of_band%' then
      raise;
    end if;
end $$;

\echo 'PASS age bands: service role can correct a locked birth year'

do $$
declare
  corrected integer := extract(year from (now() at time zone 'Asia/Seoul'))::integer - 30;
  seen integer;
begin
  execute 'set local role service_role';
  update public.profiles
  set birth_year = corrected
  where id = 'a8a8a8a8-a8a8-48a8-88a8-a8a8a8a8a8a8';
  select birth_year into seen
  from public.profiles
  where id = 'a8a8a8a8-a8a8-48a8-88a8-a8a8a8a8a8a8';
  if seen is distinct from corrected then
    raise exception 'service role did not unlock birth year, saw %', seen;
  end if;
  update public.profiles
  set birth_year = extract(year from (now() at time zone 'Asia/Seoul'))::integer - 25
  where id = 'a8a8a8a8-a8a8-48a8-88a8-a8a8a8a8a8a8';
end $$;

\echo 'PASS age bands: join follows the class band'

insert into public.classes (
  id, gym_id, title, sport_type, scheduled_at, duration_minutes, capacity, price, status, age_band
) values (
  '30000000-0000-4000-8000-0000000000a8',
  '10000000-0000-4000-8000-0000000000a8',
  'young class',
  '러닝',
  now() + interval '3 days',
  60,
  8,
  0,
  'published',
  '20_25'
);

do $$
begin
  execute 'set local role service_role';
  perform public.join_class(
    '30000000-0000-4000-8000-0000000000a8',
    'b8b8b8b8-b8b8-48b8-88b8-b8b8b8b8b8b8'
  );
  raise exception 'other band joined';
exception
  when others then
    if sqlerrm like '%other band joined%' then
      raise;
    end if;
    if sqlerrm not like '%age_band_mismatch%' then
      raise;
    end if;
end $$;

do $$
declare
  joined public.class_participants;
begin
  execute 'set local role service_role';
  joined := public.join_class(
    '30000000-0000-4000-8000-0000000000a8',
    'a8a8a8a8-a8a8-48a8-88a8-a8a8a8a8a8a8'
  );
  if joined.attendance_status is distinct from 'registered' then
    raise exception 'same band join status %', joined.attendance_status;
  end if;
  joined := public.join_class(
    '30000000-0000-4000-8000-0000000000a8',
    'c8c8c8c8-c8c8-48c8-88c8-c8c8c8c8c8c8'
  );
  if joined.user_id is distinct from 'c8c8c8c8-c8c8-48c8-88c8-c8c8c8c8c8c8' then
    raise exception 'admin join returned %', joined.user_id;
  end if;
end $$;

\echo 'PASS age bands: stored preference does not filter reveal or like'

insert into public.classes (
  id, gym_id, title, sport_type, scheduled_at, duration_minutes, capacity, price, status, age_band
) values (
  '30000000-0000-4000-8000-0000000000a9',
  '10000000-0000-4000-8000-0000000000a8',
  'reveal class',
  '러닝',
  now() - interval '3 hours',
  60,
  8,
  0,
  'completed',
  '20_25'
);

begin;
select set_config('sweating.recording_attendance', 'on', true);
insert into public.class_participants (class_id, user_id, attendance_status) values
  ('30000000-0000-4000-8000-0000000000a9', 'a8a8a8a8-a8a8-48a8-88a8-a8a8a8a8a8a8', 'attended'),
  ('30000000-0000-4000-8000-0000000000a9', 'b8b8b8b8-b8b8-48b8-88b8-b8b8b8b8b8b8', 'attended');
commit;

do $$
declare
  seen integer;
  pref text;
begin
  execute 'set local role service_role';
  select count(*) into seen
  from public.revealed_participant_user_ids(
    '30000000-0000-4000-8000-0000000000a9',
    'a8a8a8a8-a8a8-48a8-88a8-a8a8a8a8a8a8'
  );
  if seen <> 1 then
    raise exception 'cross-band reveal count %', seen;
  end if;

  select age_preference into pref
  from public.profiles
  where id = 'a8a8a8a8-a8a8-48a8-88a8-a8a8a8a8a8a8';
  if pref is distinct from 'same_band' then
    raise exception 'reveal rewrote preference %', pref;
  end if;
end $$;

do $$
declare
  result jsonb;
  pref text;
begin
  if to_regclass('public.user_consents') is null then
    return;
  end if;
  insert into public.user_consents (user_id, kind, version)
  select 'a8a8a8a8-a8a8-48a8-88a8-a8a8a8a8a8a8', kind, public.current_consent_version()
  from (values ('terms'), ('privacy'), ('overseas_transfer')) as required(kind)
  on conflict (user_id, kind, version) do nothing;
end $$;

do $$
declare
  result jsonb;
  pref text;
begin
  perform set_config('request.jwt.claim.sub', 'a8a8a8a8-a8a8-48a8-88a8-a8a8a8a8a8a8', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  result := public.like_participant(
    '30000000-0000-4000-8000-0000000000a9',
    'b8b8b8b8-b8b8-48b8-88b8-b8b8b8b8b8b8'
  );
  if result ->> 'liked' is distinct from 'true'
     or result ->> 'matched' is distinct from 'false' then
    raise exception 'cross band like failed %', result;
  end if;
  select age_preference into pref
  from public.profiles
  where id = 'a8a8a8a8-a8a8-48a8-88a8-a8a8a8a8a8a8';
  if pref is distinct from 'same_band' then
    raise exception 'like rewrote preference %', pref;
  end if;
end $$;

do $$
declare
  result jsonb;
begin
  perform set_config('request.jwt.claim.sub', 'b8b8b8b8-b8b8-48b8-88b8-b8b8b8b8b8b8', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  result := public.like_participant(
    '30000000-0000-4000-8000-0000000000a9',
    'a8a8a8a8-a8a8-48a8-88a8-a8a8a8a8a8a8'
  );
  if result ->> 'liked' is distinct from 'true'
     or result ->> 'matched' is distinct from 'true' then
    raise exception 'mutual cross-band match failed %', result;
  end if;
end $$;

\echo 'PASS age bands: under 20 cannot join and 46+ still cannot join'

do $$
declare
  child_year integer := extract(year from (now() at time zone 'Asia/Seoul'))::integer - 16;
begin
  insert into public.profiles (id, display_name, birth_year, age_preference, is_admin)
  values ('d8d8d8d8-d8d8-48d8-88d8-d8d8d8d8d8d8', 'Too Young', child_year, 'both', false);
  execute 'set local role service_role';
  perform public.join_class(
    '30000000-0000-4000-8000-0000000000a8',
    'd8d8d8d8-d8d8-48d8-88d8-d8d8d8d8d8d8'
  );
  raise exception 'under 20 joined';
exception
  when others then
    if sqlerrm like '%under 20 joined%' then
      raise;
    end if;
    if sqlerrm not like '%age_band_mismatch%' then
      raise;
    end if;
end $$;

insert into auth.users (id, email) values
  ('e8e8e8e8-e8e8-48e8-88e8-e8e8e8e8e8e8', 'band-older-out@example.com')
on conflict (id) do nothing;

insert into public.profiles (id, display_name, birth_year, age_preference, is_admin)
select
  'e8e8e8e8-e8e8-48e8-88e8-e8e8e8e8e8e8',
  'Fifty',
  extract(year from (now() at time zone 'Asia/Seoul'))::integer - 50,
  'same_band',
  false;

do $$
begin
  execute 'set local role service_role';
  perform public.join_class(
    '30000000-0000-4000-8000-0000000000a8',
    'e8e8e8e8-e8e8-48e8-88e8-e8e8e8e8e8e8'
  );
  raise exception '46 plus joined';
exception
  when others then
    if sqlerrm like '%46 plus joined%' then
      raise;
    end if;
    if sqlerrm not like '%age_band_mismatch%' then
      raise;
    end if;
end $$;

\echo 'PASS age bands: a 46+ pair can reveal, like, and match'

insert into auth.users (id, email) values
  ('f8f8f8f8-f8f8-48f8-88f8-f8f8f8f8f8f8', 'band-sixty@example.com')
on conflict (id) do nothing;

insert into public.classes (
  id, gym_id, title, sport_type, scheduled_at, duration_minutes, capacity, price, status, age_band
) values (
  '30000000-0000-4000-8000-0000000000aa',
  '10000000-0000-4000-8000-0000000000a8',
  'older reveal class',
  '러닝',
  now() - interval '3 hours',
  60,
  8,
  0,
  'completed',
  '20_25'
);

insert into public.profiles (id, display_name, birth_year, age_preference, is_admin)
select
  'f8f8f8f8-f8f8-48f8-88f8-f8f8f8f8f8f8',
  'Sixty',
  extract(year from (now() at time zone 'Asia/Seoul'))::integer - 60,
  'same_band',
  false;

begin;
select set_config('sweating.recording_attendance', 'on', true);
insert into public.class_participants (class_id, user_id, attendance_status) values
  ('30000000-0000-4000-8000-0000000000aa', 'e8e8e8e8-e8e8-48e8-88e8-e8e8e8e8e8e8', 'attended'),
  ('30000000-0000-4000-8000-0000000000aa', 'f8f8f8f8-f8f8-48f8-88f8-f8f8f8f8f8f8', 'attended');
commit;

do $$
declare
  seen integer;
begin
  execute 'set local role service_role';
  select count(*) into seen
  from public.revealed_participant_user_ids(
    '30000000-0000-4000-8000-0000000000aa',
    'e8e8e8e8-e8e8-48e8-88e8-e8e8e8e8e8e8'
  );
  if seen <> 1 then
    raise exception '46+ reveal count %', seen;
  end if;
end $$;

do $$
declare
  result jsonb;
begin
  perform set_config('request.jwt.claim.sub', 'e8e8e8e8-e8e8-48e8-88e8-e8e8e8e8e8e8', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  result := public.like_participant(
    '30000000-0000-4000-8000-0000000000aa',
    'f8f8f8f8-f8f8-48f8-88f8-f8f8f8f8f8f8'
  );
  if result ->> 'liked' is distinct from 'true'
     or result ->> 'matched' is distinct from 'false' then
    raise exception '46+ like failed %', result;
  end if;
end $$;

do $$
declare
  result jsonb;
begin
  perform set_config('request.jwt.claim.sub', 'f8f8f8f8-f8f8-48f8-88f8-f8f8f8f8f8f8', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  result := public.like_participant(
    '30000000-0000-4000-8000-0000000000aa',
    'e8e8e8e8-e8e8-48e8-88e8-e8e8e8e8e8e8'
  );
  if result ->> 'liked' is distinct from 'true'
     or result ->> 'matched' is distinct from 'true' then
    raise exception '46+ match failed %', result;
  end if;
end $$;

\echo 'AGE_BANDS_OK'
