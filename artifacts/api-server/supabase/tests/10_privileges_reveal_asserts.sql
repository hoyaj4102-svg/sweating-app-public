-- TEST ONLY. Plain psql assertions (pgTAP-style: raise on failure). Do not run against production.
-- Proves: authenticated non-admins cannot write is_admin; RLS hides other
-- users' private rows; reveal stays closed before the scheduled end and for
-- anyone who is not attended.

\set ON_ERROR_STOP on

\echo 'PASS setup: seed users, profiles, classes'

insert into auth.users (id, email) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a@example.com'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b@example.com'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'admin@example.com'),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'attended@example.com'),
  ('ffffffff-ffff-4fff-8fff-ffffffffffff', 'registered@example.com'),
  ('99999999-9999-4999-8999-999999999999', 'new@example.com');

insert into public.profiles (id, display_name, bio, is_admin) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'User A', 'private-a', false),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'User B', 'private-b-secret', false),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Admin', 'private-admin', true),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'Attended Friend', 'private-attended', false),
  ('ffffffff-ffff-4fff-8fff-ffffffffffff', 'Registered', 'private-registered', false);

insert into public.classes (
  id, gym_id, title, sport_type, scheduled_at, duration_minutes, capacity, price, status
) values
  (
    '30000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'future class',
    '러닝',
    now() + interval '2 hours',
    60,
    8,
    0,
    'published'
  ),
  (
    '30000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    'past class',
    '러닝',
    now() - interval '3 hours',
    60,
    8,
    0,
    'published'
  );

-- Attendance writes are blocked unless record_attendance set the flag as its owner.
-- This seed is the test fixture, not a client write.
begin;
select set_config('sweating.recording_attendance', 'on', true);
insert into public.class_participants (class_id, user_id, attendance_status) values
  ('30000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'attended'),
  ('30000000-0000-4000-8000-000000000001', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'attended'),
  ('30000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'attended'),
  ('30000000-0000-4000-8000-000000000002', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'attended'),
  ('30000000-0000-4000-8000-000000000002', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'no_show'),
  ('30000000-0000-4000-8000-000000000002', 'ffffffff-ffff-4fff-8fff-ffffffffffff', 'registered');
commit;

\echo 'PASS: authenticated cannot update own is_admin'

do $$
begin
  perform set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  update public.profiles
    set is_admin = true
    where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  raise exception 'own is_admin update succeeded';
exception
  when insufficient_privilege then
    if sqlerrm not like '%permission denied%' and sqlerrm not like '%is_admin_change_forbidden%' then
      raise;
    end if;
end $$;

do $$
declare
  flag boolean;
begin
  select is_admin into flag
  from public.profiles
  where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  if flag is distinct from false then
    raise exception 'own is_admin changed to %', flag;
  end if;
end $$;

\echo 'PASS: authenticated cannot update another user is_admin'

do $$
begin
  perform set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  update public.profiles
    set is_admin = true
    where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  raise exception 'other is_admin update succeeded';
exception
  when insufficient_privilege then
    if sqlerrm not like '%permission denied%' and sqlerrm not like '%is_admin_change_forbidden%' then
      raise;
    end if;
end $$;

do $$
declare
  flag boolean;
begin
  select is_admin into flag
  from public.profiles
  where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  if flag is distinct from false then
    raise exception 'other is_admin changed to %', flag;
  end if;
end $$;

-- 20261112 requires current consents before an authenticated profile write.
-- The catalog baseline does not apply that migration.
do $$
begin
  if to_regclass('public.user_consents') is null then
    return;
  end if;
  insert into public.user_consents (user_id, kind, version)
  select member_id, kind, public.current_consent_version()
  from (
    values
      ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid),
      ('99999999-9999-4999-8999-999999999999'::uuid)
  ) as members(member_id)
  cross join (values ('terms'), ('privacy'), ('overseas_transfer')) as required(kind)
  on conflict (user_id, kind, version) do nothing;
end $$;

\echo 'PASS: authenticated insert cannot set is_admin'

do $$
begin
  perform set_config('request.jwt.claim.sub', '99999999-9999-4999-8999-999999999999', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  insert into public.profiles (id, display_name, is_admin)
  values ('99999999-9999-4999-8999-999999999999', 'Escalated', true);
  raise exception 'insert with is_admin true succeeded';
exception
  when insufficient_privilege then
    if sqlerrm not like '%permission denied%' and sqlerrm not like '%is_admin_change_forbidden%' then
      raise;
    end if;
end $$;

do $$
declare
  flag boolean;
begin
  perform set_config('request.jwt.claim.sub', '99999999-9999-4999-8999-999999999999', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  insert into public.profiles (id, display_name)
  values ('99999999-9999-4999-8999-999999999999', 'Normal');
  select is_admin into flag
  from public.profiles
  where id = '99999999-9999-4999-8999-999999999999';
  if flag is distinct from false then
    raise exception 'default is_admin was %', flag;
  end if;
end $$;

\echo 'PASS: authenticated can update own display_name and still read own row with select *'

do $$
declare
  seen_name text;
  seen_admin boolean;
  seen_count integer;
  star_count integer;
begin
  perform set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  update public.profiles
    set display_name = 'User A renamed'
    where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  select count(*) into seen_count from public.profiles;
  select display_name, is_admin into seen_name, seen_admin
  from public.profiles;
  -- Column privileges must not break SELECT * (the profile API uses it).
  select count(*) into star_count from (select * from public.profiles) as own_profile;
  if star_count <> 1 then
    raise exception 'select * failed, count=%', star_count;
  end if;
  if seen_count <> 1 or seen_name <> 'User A renamed' or seen_admin is distinct from false then
    raise exception 'own profile read/update failed count=% name=% admin=%', seen_count, seen_name, seen_admin;
  end if;
end $$;

\echo 'PASS: spoofed service_role JWT cannot change is_admin without the service_role'

begin;
grant update on table public.profiles to authenticated;
do $$
begin
  perform set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);
  perform set_config('request.jwt.claim.role', 'service_role', true);
  execute 'set local role authenticated';
  update public.profiles
    set is_admin = true
    where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  raise exception 'spoofed jwt changed is_admin';
exception
  when insufficient_privilege then
    if sqlerrm not like '%is_admin_change_forbidden%' then
      raise;
    end if;
end $$;
rollback;

do $$
declare
  flag boolean;
begin
  select is_admin into flag
  from public.profiles
  where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  if flag is distinct from false then
    raise exception 'spoof left is_admin=%', flag;
  end if;
end $$;

\echo 'PASS: service_role can change is_admin and the column can be restored'

do $$
declare
  flag boolean;
begin
  execute 'set local role service_role';
  update public.profiles
    set is_admin = true
    where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  if not found then
    raise exception 'service_role update did not touch the row';
  end if;
  select is_admin into flag
  from public.profiles
  where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  if flag is distinct from true then
    raise exception 'service_role did not set is_admin';
  end if;
  update public.profiles
    set is_admin = false
    where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
end $$;

\echo 'PASS: RLS hides other users private profile fields and participant rows'

do $$
declare
  seen_profiles integer;
  seen_bio text;
  seen_participants integer;
  renamed text;
begin
  perform set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';

  select count(*) into seen_profiles from public.profiles;
  select string_agg(bio, ',') into seen_bio from public.profiles;
  select count(*) into seen_participants from public.class_participants;

  if seen_profiles <> 1 then
    raise exception 'profile RLS leaked rows: %', seen_profiles;
  end if;
  if seen_bio is distinct from 'private-a' or seen_bio like '%private-b-secret%' then
    raise exception 'profile RLS leaked bio: %', seen_bio;
  end if;
  if seen_participants <> 2 then
    raise exception 'participant RLS leaked rows: % (expected own rows only)', seen_participants;
  end if;

  update public.profiles
    set display_name = 'hacked'
    where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  -- RLS hides the other row, so this must not report a match.
  if found then
    raise exception 'updated another user profile';
  end if;
end $$;

do $$
declare
  renamed text;
begin
  select display_name into renamed
  from public.profiles
  where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  if renamed is distinct from 'User B' then
    raise exception 'other display_name changed to %', renamed;
  end if;
end $$;

\echo 'PASS: anon cannot read profiles'

do $$
declare
  seen integer;
begin
  execute 'set local role anon';
  select count(*) into seen from public.profiles;
  if seen <> 0 then
    raise exception 'anon read % profiles', seen;
  end if;
end $$;

\echo 'PASS: non-admin cannot complete a class'

do $$
begin
  perform set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  perform public.complete_class('30000000-0000-4000-8000-000000000002');
  raise exception 'non-admin completed class';
exception
  when others then
    if sqlerrm like '%non-admin completed class%' then
      raise;
    end if;
    if sqlerrm not like '%admin_required%' then
      raise;
    end if;
end $$;

\echo 'PASS: complete_class and direct update refuse before the scheduled end'

do $$
begin
  perform set_config('request.jwt.claim.sub', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  perform public.complete_class('30000000-0000-4000-8000-000000000001');
  raise exception 'completed class before end';
exception
  when others then
    if sqlerrm like '%completed class before end%' then
      raise;
    end if;
    if sqlerrm not like '%class_not_finished%' then
      raise;
    end if;
end $$;

do $$
declare
  class_status text;
begin
  select status into class_status
  from public.classes
  where id = '30000000-0000-4000-8000-000000000001';
  if class_status is distinct from 'published' then
    raise exception 'future class status became %', class_status;
  end if;
end $$;

do $$
begin
  execute 'set local role service_role';
  update public.classes
    set status = 'completed'
    where id = '30000000-0000-4000-8000-000000000001';
  raise exception 'service_role completed class before end';
exception
  when others then
    if sqlerrm like '%service_role completed class before end%' then
      raise;
    end if;
    if sqlerrm not like '%class_not_finished%' then
      raise;
    end if;
end $$;

\echo 'PASS: reveal stays closed before the scheduled end even if status is forced'

alter table public.classes disable trigger classes_prevent_early_completion;
update public.classes
  set status = 'completed'
  where id = '30000000-0000-4000-8000-000000000001';
alter table public.classes enable trigger classes_prevent_early_completion;

do $$
declare
  open boolean;
  revealed_count integer;
begin
  if public.class_reveal_open('30000000-0000-4000-8000-000000000001') then
    raise exception 'class_reveal_open before scheduled end';
  end if;
  select count(*) into revealed_count
  from public.revealed_participant_user_ids(
    '30000000-0000-4000-8000-000000000001',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  );
  if revealed_count <> 0 then
    raise exception 'revealed % participants before scheduled end', revealed_count;
  end if;
  select public.class_reveal_open('30000000-0000-4000-8000-000000000001') into open;
  if open then
    raise exception 'reveal flag true before end';
  end if;
end $$;

update public.classes
  set status = 'published'
  where id = '30000000-0000-4000-8000-000000000001';

\echo 'PASS: after the scheduled end only attended participants are revealed'

do $$
declare
  completed_status text;
begin
  perform set_config('request.jwt.claim.sub', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  select status into completed_status
  from public.complete_class('30000000-0000-4000-8000-000000000002');
  if completed_status is distinct from 'completed' then
    raise exception 'admin complete after end returned %', completed_status;
  end if;
end $$;

do $$
declare
  revealed uuid[];
begin
  if not public.class_reveal_open('30000000-0000-4000-8000-000000000002') then
    raise exception 'class_reveal_open false after scheduled end';
  end if;

  select coalesce(array_agg(user_id order by user_id), '{}') into revealed
  from public.revealed_participant_user_ids(
    '30000000-0000-4000-8000-000000000002',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  );
  if revealed <> array['dddddddd-dddd-4ddd-8ddd-dddddddddddd']::uuid[] then
    raise exception 'attended reveal set was %', revealed;
  end if;

  select coalesce(array_agg(user_id), '{}') into revealed
  from public.revealed_participant_user_ids(
    '30000000-0000-4000-8000-000000000002',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  );
  if revealed <> '{}'::uuid[] then
    raise exception 'no_show viewer revealed %', revealed;
  end if;

  select coalesce(array_agg(user_id), '{}') into revealed
  from public.revealed_participant_user_ids(
    '30000000-0000-4000-8000-000000000002',
    'ffffffff-ffff-4fff-8fff-ffffffffffff'
  );
  if revealed <> '{}'::uuid[] then
    raise exception 'registered viewer revealed %', revealed;
  end if;
end $$;

\echo 'PASS: likes follow the same end time and attended gate'

do $$
begin
  perform set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  perform public.like_participant(
    '30000000-0000-4000-8000-000000000001',
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
  );
  raise exception 'like before end succeeded';
exception
  when others then
    if sqlerrm like '%like before end succeeded%' then
      raise;
    end if;
    if sqlerrm not like '%class_not_completed%' then
      raise;
    end if;
end $$;

do $$
begin
  perform set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  perform public.like_participant(
    '30000000-0000-4000-8000-000000000002',
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
declare
  liked boolean;
begin
  perform set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  select (public.like_participant(
    '30000000-0000-4000-8000-000000000002',
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
  ) ->> 'liked')::boolean into liked;
  if liked is distinct from true then
    raise exception 'attended like after end failed';
  end if;
end $$;

\echo 'SQL_ASSERTS_OK'
