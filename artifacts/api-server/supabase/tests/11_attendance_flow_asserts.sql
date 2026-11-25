-- TEST ONLY. Do not run against production.
-- Attendance recorded by the gym owner or an admin, then the class ends,
-- reveal lists only attended participants, mutual likes create one match.
-- Negative cases: participant self-mark, non-admin, direct update, before
-- start, after the 24 hour window, no_show excluded.

\set ON_ERROR_STOP on

\echo 'PASS setup: gym owner and attendance classes'

insert into auth.users (id, email) values
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'owner@example.com');

insert into public.profiles (id, display_name, is_admin) values
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'Gym Owner', false);

insert into public.gyms (id, name, address, city) values
  ('10000000-0000-4000-8000-000000000099', '출석 테스트 짐', '예시시', '예시시');

insert into public.gym_owners (gym_id, user_id) values
  ('10000000-0000-4000-8000-000000000099', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');

insert into public.classes (
  id, gym_id, title, sport_type, scheduled_at, duration_minutes, capacity, price, status
) values
  (
    '30000000-0000-4000-8000-000000000010',
    '10000000-0000-4000-8000-000000000099',
    'attendance flow',
    '러닝',
    now() - interval '20 minutes',
    60,
    8,
    0,
    'published'
  ),
  (
    '30000000-0000-4000-8000-000000000011',
    '10000000-0000-4000-8000-000000000099',
    'not started',
    '러닝',
    now() + interval '2 hours',
    60,
    8,
    0,
    'published'
  ),
  (
    '30000000-0000-4000-8000-000000000012',
    '10000000-0000-4000-8000-000000000099',
    'window closed',
    '러닝',
    now() - interval '30 hours',
    60,
    8,
    0,
    'published'
  ),
  (
    '30000000-0000-4000-8000-000000000013',
    '10000000-0000-4000-8000-000000000099',
    'owner self',
    '러닝',
    now() - interval '20 minutes',
    60,
    8,
    0,
    'published'
  );

insert into public.class_participants (class_id, user_id, attendance_status) values
  ('30000000-0000-4000-8000-000000000010', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'registered'),
  ('30000000-0000-4000-8000-000000000010', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'registered'),
  ('30000000-0000-4000-8000-000000000010', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'registered'),
  ('30000000-0000-4000-8000-000000000010', 'ffffffff-ffff-4fff-8fff-ffffffffffff', 'registered'),
  ('30000000-0000-4000-8000-000000000011', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'registered'),
  ('30000000-0000-4000-8000-000000000012', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'registered'),
  ('30000000-0000-4000-8000-000000000013', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'registered');

\echo 'PASS: clients cannot read gym owners'

do $$
declare
  seen integer;
begin
  perform set_config('request.jwt.claim.sub', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  select count(*) into seen from public.gym_owners;
  if seen <> 0 then
    raise exception 'authenticated read % gym owners', seen;
  end if;
end $$;

do $$
begin
  perform set_config('request.jwt.claim.sub', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  insert into public.gym_owners (gym_id, user_id)
  values (
    '10000000-0000-4000-8000-000000000001',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  );
  raise exception 'authenticated inserted gym owner';
exception
  when insufficient_privilege then
    if sqlerrm not like '%permission denied%' then
      raise;
    end if;
end $$;

\echo 'PASS: participant cannot record own attendance'

do $$
begin
  perform set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  perform public.record_attendance(
    '30000000-0000-4000-8000-000000000010',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'attended'
  );
  raise exception 'participant self-mark succeeded';
exception
  when others then
    if sqlerrm like '%participant self-mark succeeded%' then
      raise;
    end if;
    if sqlerrm not like '%attendance_forbidden%' then
      raise;
    end if;
end $$;

\echo 'PASS: non-admin cannot record another participant'

do $$
begin
  perform set_config('request.jwt.claim.sub', '99999999-9999-4999-8999-999999999999', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  perform public.record_attendance(
    '30000000-0000-4000-8000-000000000010',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'attended'
  );
  raise exception 'non-admin recorded attendance';
exception
  when others then
    if sqlerrm like '%non-admin recorded attendance%' then
      raise;
    end if;
    if sqlerrm not like '%attendance_forbidden%' then
      raise;
    end if;
end $$;

\echo 'PASS: direct attendance update is rejected'

do $$
begin
  perform set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  update public.class_participants
    set attendance_status = 'attended'
    where class_id = '30000000-0000-4000-8000-000000000010'
      and user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  raise exception 'participant updated own attendance';
exception
  when insufficient_privilege then
    if sqlerrm not like '%permission denied%' and sqlerrm not like '%attendance_change_forbidden%' then
      raise;
    end if;
end $$;

begin;
grant update on table public.class_participants to authenticated;
drop policy if exists participants_no_direct_update on public.class_participants;
create policy participants_test_update
on public.class_participants
for update
to authenticated
using (true)
with check (true);
do $$
begin
  perform set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('sweating.recording_attendance', 'on', true);
  execute 'set local role authenticated';
  update public.class_participants
    set attendance_status = 'attended'
    where class_id = '30000000-0000-4000-8000-000000000010'
      and user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  raise exception 'guc bypass succeeded';
exception
  when insufficient_privilege then
    if sqlerrm not like '%attendance_change_forbidden%' then
      raise;
    end if;
end $$;
rollback;

do $$
begin
  perform set_config('sweating.recording_attendance', 'on', true);
  execute 'set local role service_role';
  update public.class_participants
    set attendance_status = 'attended'
    where class_id = '30000000-0000-4000-8000-000000000010'
      and user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  raise exception 'service_role bypass succeeded';
exception
  when others then
    if sqlerrm like '%service_role bypass succeeded%' then
      raise;
    end if;
    if sqlerrm not like '%attendance_change_forbidden%' then
      raise;
    end if;
end $$;

do $$
declare
  still_registered integer;
begin
  select count(*) into still_registered
  from public.class_participants
  where class_id = '30000000-0000-4000-8000-000000000010'
    and attendance_status = 'registered';
  if still_registered <> 4 then
    raise exception 'flow class attendance changed before an authorized record: %', still_registered;
  end if;
end $$;

\echo 'PASS: attendance is refused before the class starts'

do $$
begin
  perform set_config('request.jwt.claim.sub', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  perform public.record_attendance(
    '30000000-0000-4000-8000-000000000011',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'attended'
  );
  raise exception 'recorded attendance before start';
exception
  when others then
    if sqlerrm like '%recorded attendance before start%' then
      raise;
    end if;
    if sqlerrm not like '%attendance_too_early%' then
      raise;
    end if;
end $$;

do $$
declare
  status text;
begin
  select attendance_status into status
  from public.class_participants
  where class_id = '30000000-0000-4000-8000-000000000011'
    and user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  if status is distinct from 'registered' then
    raise exception 'future class attendance became %', status;
  end if;
end $$;

\echo 'PASS: attendance is refused after the 24 hour window'

do $$
begin
  perform set_config('request.jwt.claim.sub', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  perform public.record_attendance(
    '30000000-0000-4000-8000-000000000012',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'no_show'
  );
  raise exception 'recorded attendance after window';
exception
  when others then
    if sqlerrm like '%recorded attendance after window%' then
      raise;
    end if;
    if sqlerrm not like '%attendance_window_closed%' then
      raise;
    end if;
end $$;

\echo 'PASS: gym owner records attended and admin records no_show'

do $$
declare
  recorded text;
begin
  perform set_config('request.jwt.claim.sub', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';

  select attendance_status into recorded
  from public.record_attendance(
    '30000000-0000-4000-8000-000000000010',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'attended'
  );
  if recorded is distinct from 'attended' then
    raise exception 'owner record A returned %', recorded;
  end if;

  select attendance_status into recorded
  from public.record_attendance(
    '30000000-0000-4000-8000-000000000010',
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    'attended'
  );
  if recorded is distinct from 'attended' then
    raise exception 'owner record D returned %', recorded;
  end if;

  -- Same status again is a no-op success.
  select attendance_status into recorded
  from public.record_attendance(
    '30000000-0000-4000-8000-000000000010',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'attended'
  );
  if recorded is distinct from 'attended' then
    raise exception 'idempotent record returned %', recorded;
  end if;
end $$;

do $$
declare
  recorded text;
begin
  perform set_config('request.jwt.claim.sub', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  select attendance_status into recorded
  from public.record_attendance(
    '30000000-0000-4000-8000-000000000010',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'no_show'
  );
  if recorded is distinct from 'no_show' then
    raise exception 'admin no_show returned %', recorded;
  end if;
end $$;

do $$
declare
  registered_count integer;
  attended_count integer;
begin
  select count(*) into registered_count
  from public.class_participants
  where class_id = '30000000-0000-4000-8000-000000000010'
    and user_id = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
    and attendance_status = 'registered';
  select count(*) into attended_count
  from public.class_participants
  where class_id = '30000000-0000-4000-8000-000000000010'
    and attendance_status = 'attended';
  if registered_count <> 1 or attended_count <> 2 then
    raise exception 'unexpected statuses registered=% attended=%', registered_count, attended_count;
  end if;
end $$;

\echo 'PASS: gym owner can record their own attendance'

do $$
declare
  recorded text;
begin
  perform set_config('request.jwt.claim.sub', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  select attendance_status into recorded
  from public.record_attendance(
    '30000000-0000-4000-8000-000000000013',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    'attended'
  );
  if recorded is distinct from 'attended' then
    raise exception 'owner self record returned %', recorded;
  end if;
end $$;

\echo 'PASS: reveal stays closed until the class end even after attendance'

do $$
begin
  if public.class_reveal_open('30000000-0000-4000-8000-000000000010') then
    raise exception 'reveal open before the scheduled end';
  end if;
  perform set_config('request.jwt.claim.sub', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  perform public.complete_class('30000000-0000-4000-8000-000000000010');
  raise exception 'completed class before end';
exception
  when others then
    if sqlerrm like '%completed class before end%' or sqlerrm like '%reveal open before%' then
      raise;
    end if;
    if sqlerrm not like '%class_not_finished%' then
      raise;
    end if;
end $$;

\echo 'PASS: attendance then class end then reveal shows only attended'

update public.classes
set scheduled_at = now() - interval '3 hours'
where id = '30000000-0000-4000-8000-000000000010';

do $$
declare
  completed_status text;
begin
  perform set_config('request.jwt.claim.sub', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  select status into completed_status
  from public.complete_class('30000000-0000-4000-8000-000000000010');
  if completed_status is distinct from 'completed' then
    raise exception 'complete after end returned %', completed_status;
  end if;
end $$;

do $$
declare
  revealed uuid[];
begin
  if not public.class_reveal_open('30000000-0000-4000-8000-000000000010') then
    raise exception 'reveal still closed after the scheduled end';
  end if;

  select coalesce(array_agg(user_id order by user_id), '{}') into revealed
  from public.revealed_participant_user_ids(
    '30000000-0000-4000-8000-000000000010',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  );
  if revealed <> array['dddddddd-dddd-4ddd-8ddd-dddddddddddd']::uuid[] then
    raise exception 'A reveal set was %', revealed;
  end if;

  select coalesce(array_agg(user_id order by user_id), '{}') into revealed
  from public.revealed_participant_user_ids(
    '30000000-0000-4000-8000-000000000010',
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
  );
  if revealed <> array['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa']::uuid[] then
    raise exception 'D reveal set was %', revealed;
  end if;

  select coalesce(array_agg(user_id), '{}') into revealed
  from public.revealed_participant_user_ids(
    '30000000-0000-4000-8000-000000000010',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  );
  if revealed <> '{}'::uuid[] then
    raise exception 'no_show reveal set was %', revealed;
  end if;

  select coalesce(array_agg(user_id), '{}') into revealed
  from public.revealed_participant_user_ids(
    '30000000-0000-4000-8000-000000000010',
    'ffffffff-ffff-4fff-8fff-ffffffffffff'
  );
  if revealed <> '{}'::uuid[] then
    raise exception 'registered reveal set was %', revealed;
  end if;
end $$;

\echo 'PASS: no_show is excluded from reveal and cannot like'

do $$
begin
  perform set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  perform public.like_participant(
    '30000000-0000-4000-8000-000000000010',
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
  );
  raise exception 'no_show like succeeded';
exception
  when others then
    if sqlerrm like '%no_show like succeeded%' then
      raise;
    end if;
    if sqlerrm not like '%participants_only%' then
      raise;
    end if;
end $$;

do $$
begin
  perform set_config('request.jwt.claim.sub', 'ffffffff-ffff-4fff-8fff-ffffffffffff', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  perform public.like_participant(
    '30000000-0000-4000-8000-000000000010',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  );
  raise exception 'registered like succeeded';
exception
  when others then
    if sqlerrm like '%registered like succeeded%' then
      raise;
    end if;
    if sqlerrm not like '%participants_only%' then
      raise;
    end if;
end $$;

\echo 'PASS: mutual like creates exactly one match'

do $$
declare
  first_match boolean;
  match_count integer;
  pair_count integer;
begin
  perform set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  select (public.like_participant(
    '30000000-0000-4000-8000-000000000010',
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
  ) ->> 'matched')::boolean into first_match;
  if first_match is distinct from false then
    raise exception 'one-way like already matched';
  end if;

  perform set_config('request.jwt.claim.sub', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', true);
  select (public.like_participant(
    '30000000-0000-4000-8000-000000000010',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  ) ->> 'matched')::boolean into first_match;
  if first_match is distinct from true then
    raise exception 'mutual like did not match';
  end if;

  perform set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);
  perform public.like_participant(
    '30000000-0000-4000-8000-000000000010',
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
  );
  perform set_config('request.jwt.claim.sub', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', true);
  perform public.like_participant(
    '30000000-0000-4000-8000-000000000010',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  );

  select count(*) into match_count
  from public.matches
  where class_id = '30000000-0000-4000-8000-000000000010';
  select count(*) into pair_count
  from public.matches
  where class_id = '30000000-0000-4000-8000-000000000010'
    and user_a_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    and user_b_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  if match_count <> 1 or pair_count <> 1 then
    raise exception 'expected one match, count=% pair=%', match_count, pair_count;
  end if;
end $$;

\echo 'PASS: attendance is locked after a like'

do $$
declare
  status text;
begin
  perform set_config('request.jwt.claim.sub', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  perform public.record_attendance(
    '30000000-0000-4000-8000-000000000010',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'no_show'
  );
  raise exception 'attendance changed after like';
exception
  when others then
    if sqlerrm like '%attendance changed after like%' then
      raise;
    end if;
    if sqlerrm not like '%attendance_locked%' then
      raise;
    end if;
end $$;

do $$
declare
  status text;
  match_count integer;
begin
  select attendance_status into status
  from public.class_participants
  where class_id = '30000000-0000-4000-8000-000000000010'
    and user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  select count(*) into match_count
  from public.matches
  where class_id = '30000000-0000-4000-8000-000000000010';
  if status is distinct from 'attended' or match_count <> 1 then
    raise exception 'like lock failed status=% matches=%', status, match_count;
  end if;
end $$;

\echo 'ATTENDANCE_FLOW_OK'
