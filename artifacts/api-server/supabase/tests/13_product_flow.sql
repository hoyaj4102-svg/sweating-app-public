-- SQL stand-in for signup -> join -> admin attendance -> reveal -> like -> match.
-- The API creates auth users through Supabase Auth. This stub inserts auth.users,
-- then the member inserts their own profile as the authenticated role.
-- join_class is called as service_role, which is what the API does.
-- Time is moved only inside this test so one transaction can pass the
-- attendance window and the scheduled end. Do not run against a hosted project.

\set ON_ERROR_STOP on

\echo 'PASS product flow: signup profile'

insert into auth.users (id, email) values
  ('12121212-1212-4121-8121-121212121212', 'flow-member@example.com'),
  ('13131313-1313-4131-8131-131313131313', 'flow-partner@example.com'),
  ('14141414-1414-4141-8141-141414141414', 'flow-admin@example.com');

do $$
begin
  if to_regclass('public.user_consents') is null then
    return;
  end if;
  insert into public.user_consents (user_id, kind, version)
  select member_id, kind, public.current_consent_version()
  from (
    values
      ('12121212-1212-4121-8121-121212121212'::uuid),
      ('13131313-1313-4131-8131-131313131313'::uuid)
  ) as members(member_id)
  cross join (values ('terms'), ('privacy'), ('overseas_transfer')) as required(kind)
  on conflict (user_id, kind, version) do nothing;
end $$;

do $$
begin
  perform set_config('request.jwt.claim.sub', '12121212-1212-4121-8121-121212121212', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  insert into public.profiles (id, display_name)
  values ('12121212-1212-4121-8121-121212121212', 'Flow Member');
end $$;

do $$
begin
  perform set_config('request.jwt.claim.sub', '13131313-1313-4131-8131-131313131313', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  insert into public.profiles (id, display_name)
  values ('13131313-1313-4131-8131-131313131313', 'Flow Partner');
end $$;

insert into public.profiles (id, display_name, is_admin)
values ('14141414-1414-4141-8141-141414141414', 'Flow Admin', true);

do $$
declare
  flag boolean;
begin
  perform set_config('request.jwt.claim.sub', '12121212-1212-4121-8121-121212121212', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  select is_admin into flag
  from public.profiles
  where id = '12121212-1212-4121-8121-121212121212';
  if flag is distinct from false then
    raise exception 'signup profile is_admin is %', flag;
  end if;
end $$;

\echo 'PASS product flow: join future class as service role'

insert into public.gyms (id, name, address, city)
values ('10000000-0000-4000-8000-0000000000a1', 'Flow Gym', 'Busan', 'Busan');

insert into public.classes (
  id, gym_id, title, sport_type, scheduled_at, duration_minutes, capacity, price, status
) values (
  '30000000-0000-4000-8000-000000000020',
  '10000000-0000-4000-8000-0000000000a1',
  'flow class',
  '러닝',
  now() + interval '2 hours',
  60,
  8,
  0,
  'published'
);

do $$
declare
  joined public.class_participants;
begin
  execute 'set local role service_role';
  joined := public.join_class(
    '30000000-0000-4000-8000-000000000020',
    '12121212-1212-4121-8121-121212121212'
  );
  if joined.attendance_status is distinct from 'registered' then
    raise exception 'member join status %', joined.attendance_status;
  end if;
  joined := public.join_class(
    '30000000-0000-4000-8000-000000000020',
    '13131313-1313-4131-8131-131313131313'
  );
  if joined.user_id is distinct from '13131313-1313-4131-8131-131313131313' then
    raise exception 'partner join returned %', joined.user_id;
  end if;
end $$;

\echo 'PASS product flow: admin attendance after the scheduled start'

update public.classes
set scheduled_at = now() - interval '10 minutes'
where id = '30000000-0000-4000-8000-000000000020';

do $$
declare
  recorded text;
begin
  perform set_config('request.jwt.claim.sub', '14141414-1414-4141-8141-141414141414', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  select attendance_status into recorded
  from public.record_attendance(
    '30000000-0000-4000-8000-000000000020',
    '12121212-1212-4121-8121-121212121212',
    'attended'
  );
  if recorded is distinct from 'attended' then
    raise exception 'member attendance %', recorded;
  end if;
  select attendance_status into recorded
  from public.record_attendance(
    '30000000-0000-4000-8000-000000000020',
    '13131313-1313-4131-8131-131313131313',
    'attended'
  );
  if recorded is distinct from 'attended' then
    raise exception 'partner attendance %', recorded;
  end if;
end $$;

\echo 'PASS product flow: reveal then mutual like'

update public.classes
set scheduled_at = now() - interval '3 hours'
where id = '30000000-0000-4000-8000-000000000020';

do $$
declare
  completed_status text;
begin
  perform set_config('request.jwt.claim.sub', '14141414-1414-4141-8141-141414141414', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  select status into completed_status
  from public.complete_class('30000000-0000-4000-8000-000000000020');
  if completed_status is distinct from 'completed' then
    raise exception 'complete_class status %', completed_status;
  end if;
end $$;

do $$
declare
  seen uuid;
  seen_count integer;
begin
  execute 'set local role service_role';
  select count(*) into seen_count
  from public.revealed_participant_user_ids(
    '30000000-0000-4000-8000-000000000020',
    '12121212-1212-4121-8121-121212121212'
  );
  if seen_count <> 1 then
    raise exception 'reveal count %', seen_count;
  end if;
  select user_id into seen
  from public.revealed_participant_user_ids(
    '30000000-0000-4000-8000-000000000020',
    '12121212-1212-4121-8121-121212121212'
  );
  if seen is distinct from '13131313-1313-4131-8131-131313131313' then
    raise exception 'reveal returned %', seen;
  end if;
end $$;

do $$
declare
  result jsonb;
begin
  perform set_config('request.jwt.claim.sub', '12121212-1212-4121-8121-121212121212', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  result := public.like_participant(
    '30000000-0000-4000-8000-000000000020',
    '13131313-1313-4131-8131-131313131313'
  );
  if result ->> 'liked' is distinct from 'true' or result ->> 'matched' is distinct from 'false' then
    raise exception 'first like %', result;
  end if;
end $$;

do $$
declare
  result jsonb;
begin
  perform set_config('request.jwt.claim.sub', '13131313-1313-4131-8131-131313131313', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  result := public.like_participant(
    '30000000-0000-4000-8000-000000000020',
    '12121212-1212-4121-8121-121212121212'
  );
  if result ->> 'matched' is distinct from 'true' or result ->> 'match_id' is null then
    raise exception 'second like %', result;
  end if;
end $$;

do $$
declare
  match_count integer;
begin
  -- The API reads matches with the service role. The catalog seed does not
  -- grant authenticated SELECT on matches.
  execute 'set local role service_role';
  select count(*) into match_count
  from public.matches
  where class_id = '30000000-0000-4000-8000-000000000020';
  if match_count <> 1 then
    raise exception 'match count %', match_count;
  end if;
end $$;

\echo 'PRODUCT_FLOW_OK'
