-- TEST ONLY. Proves the fix. Do not run against production.
\set ON_ERROR_STOP on

\echo 'PASS: anon and authenticated keep select and lose participant DML'

do $$
declare
  role_name text;
  privilege text;
begin
  foreach role_name in array array['anon', 'authenticated']
  loop
    if not has_table_privilege(role_name, 'public.class_participants', 'SELECT') then
      raise exception '% lost select on class_participants', role_name;
    end if;
    foreach privilege in array array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'TRIGGER', 'REFERENCES']
    loop
      if has_table_privilege(role_name, 'public.class_participants', privilege) then
        raise exception '% still has % on class_participants', role_name, privilege;
      end if;
    end loop;
  end loop;

  if not has_table_privilege('service_role', 'public.class_participants', 'INSERT')
     or not has_table_privilege('service_role', 'public.class_participants', 'UPDATE')
     or not has_table_privilege('service_role', 'public.class_participants', 'SELECT') then
    raise exception 'service_role lost a required class_participants privilege';
  end if;

  if has_function_privilege('anon', 'public.complete_class(uuid)', 'EXECUTE') then
    raise exception 'anon can execute complete_class';
  end if;
  if not has_function_privilege('authenticated', 'public.complete_class(uuid)', 'EXECUTE') then
    raise exception 'authenticated admin cannot execute complete_class';
  end if;
  if has_function_privilege('authenticated', 'public.join_class(uuid,uuid)', 'EXECUTE') then
    raise exception 'authenticated can execute join_class';
  end if;
  if not has_function_privilege('service_role', 'public.join_class(uuid,uuid)', 'EXECUTE') then
    raise exception 'service_role cannot execute join_class';
  end if;
  if to_regprocedure('public.mark_attendance(uuid,uuid,text)') is not null then
    raise exception 'this branch must not define mark_attendance';
  end if;
end $$;

\echo 'PASS: client attendance write fails even with row level security off'

begin;
alter table public.class_participants disable row level security;
insert into auth.users (id, email) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'user@example.com');
insert into public.profiles (id, display_name) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'User');
insert into public.class_participants (id, class_id, user_id, attendance_status) values
  (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
    '20000000-0000-4000-8000-000000000001',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    'registered'
  );
do $$
begin
  perform set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', true);
  execute 'set local role authenticated';
  update public.class_participants
    set attendance_status = 'attended'
    where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
  raise exception 'client attendance update succeeded';
exception
  when insufficient_privilege then
    if sqlerrm not like '%permission denied%' then
      raise;
    end if;
end $$;
do $$
declare
  seen text;
begin
  select attendance_status into seen
  from public.class_participants
  where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
  if seen is distinct from 'registered' then
    raise exception 'attendance changed to %', seen;
  end if;
end $$;
rollback;

\echo 'PASS: anon cannot truncate class_participants'

do $$
begin
  execute 'set local role anon';
  truncate public.class_participants;
  raise exception 'anon truncated class_participants';
exception
  when insufficient_privilege then
    if sqlerrm not like '%permission denied%' then
      raise;
    end if;
end $$;

\echo 'PASS: authenticated cannot grant itself is_admin or insert an admin profile'

begin;
insert into auth.users (id, email) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'user@example.com'),
  ('99999999-9999-4999-8999-999999999999', 'new@example.com');
insert into public.profiles (id, display_name, is_admin) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'User', false);
do $$
begin
  perform set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', true);
  execute 'set local role authenticated';
  update public.profiles
    set is_admin = true
    where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
  raise exception 'own is_admin update succeeded';
exception
  when insufficient_privilege then
    if sqlerrm not like '%is_admin_change_forbidden%' then
      raise;
    end if;
end $$;
do $$
begin
  perform set_config('request.jwt.claim.sub', '99999999-9999-4999-8999-999999999999', true);
  execute 'set local role authenticated';
  insert into public.profiles (id, display_name, is_admin)
  values ('99999999-9999-4999-8999-999999999999', 'Escalated', true);
  raise exception 'insert with is_admin true succeeded';
exception
  when insufficient_privilege then
    if sqlerrm not like '%is_admin_change_forbidden%' then
      raise;
    end if;
end $$;
do $$
declare
  flag boolean;
begin
  select is_admin into flag
  from public.profiles
  where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
  if flag is distinct from false then
    raise exception 'is_admin changed to %', flag;
  end if;
end $$;
rollback;

\echo 'PASS: spoofed service_role claim cannot change is_admin'

begin;
insert into auth.users (id, email) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'user@example.com');
insert into public.profiles (id, display_name, is_admin) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'User', false);
do $$
begin
  perform set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', true);
  perform set_config('request.jwt.claim.role', 'service_role', true);
  execute 'set local role authenticated';
  update public.profiles
    set is_admin = true
    where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
  raise exception 'spoofed jwt changed is_admin';
exception
  when insufficient_privilege then
    if sqlerrm not like '%is_admin_change_forbidden%' then
      raise;
    end if;
end $$;
rollback;

\echo 'PASS: authenticated can rename itself and service_role can set is_admin'

begin;
insert into auth.users (id, email) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'user@example.com');
insert into public.profiles (id, display_name, is_admin) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'User', false);
do $$
declare
  seen text;
begin
  perform set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', true);
  execute 'set local role authenticated';
  update public.profiles
    set display_name = 'Renamed'
    where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
  select display_name into seen
  from public.profiles
  where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
  if seen is distinct from 'Renamed' then
    raise exception 'display_name update failed, got %', seen;
  end if;
end $$;
do $$
declare
  flag boolean;
begin
  execute 'set local role service_role';
  update public.profiles
    set is_admin = true
    where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
  select is_admin into flag
  from public.profiles
  where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
  if flag is distinct from true then
    raise exception 'service_role did not set is_admin';
  end if;
end $$;
rollback;

\echo 'PASS: non-admin complete_class is rejected and an admin can complete'

begin;
insert into auth.users (id, email) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'user@example.com'),
  ('cccccccc-cccc-4ccc-8ccc-ccccccccccc1', 'admin@example.com');
insert into public.profiles (id, display_name, is_admin) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'User', false),
  ('cccccccc-cccc-4ccc-8ccc-ccccccccccc1', 'Admin', true);
insert into public.classes (
  id, gym_id, title, sport_type, scheduled_at, duration_minutes, capacity, price, status
) values (
  '30000000-0000-4000-8000-000000000099',
  '10000000-0000-4000-8000-000000000001',
  'authz class',
  '러닝',
  now() - interval '1 day',
  60,
  4,
  0,
  'published'
);
do $$
begin
  perform set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', true);
  perform public.complete_class('30000000-0000-4000-8000-000000000099');
  raise exception 'non-admin complete_class succeeded';
exception
  when others then
    if sqlerrm not like '%admin_required%' then
      raise;
    end if;
end $$;
do $$
declare
  seen text;
begin
  perform set_config('request.jwt.claim.sub', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1', true);
  select status into seen
  from public.complete_class('30000000-0000-4000-8000-000000000099');
  if seen is distinct from 'completed' then
    raise exception 'admin complete_class returned %', seen;
  end if;
end $$;
do $$
begin
  perform set_config('request.jwt.claim.sub', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1', true);
  update public.classes
    set status = 'cancelled'
    where id = '30000000-0000-4000-8000-000000000099';
  perform public.complete_class('30000000-0000-4000-8000-000000000099');
  raise exception 'cancelled class was completed';
exception
  when others then
    if sqlerrm not like '%class_not_found%' then
      raise;
    end if;
end $$;
rollback;

\echo 'PASS: anon can read published classes and cannot execute complete_class'

do $$
declare
  seen integer;
begin
  execute 'set local role anon';
  select count(*) into seen
  from public.classes
  where status = 'published';
  if seen < 1 then
    raise exception 'anon saw % published classes', seen;
  end if;
end $$;

do $$
begin
  execute 'set local role anon';
  perform public.complete_class('20000000-0000-4000-8000-000000000001');
  raise exception 'anon executed complete_class';
exception
  when insufficient_privilege then
    if sqlerrm not like '%permission denied%' then
      raise;
    end if;
end $$;

\echo 'PASS: service_role can join a class and authenticated cannot'

begin;
insert into auth.users (id, email) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'user@example.com');
insert into public.profiles (id, display_name) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'User');
insert into public.classes (
  id, gym_id, title, sport_type, scheduled_at, duration_minutes, capacity, price, status
) values (
  '30000000-0000-4000-8000-000000000098',
  '10000000-0000-4000-8000-000000000001',
  'future class',
  '러닝',
  now() + interval '2 days',
  60,
  4,
  0,
  'published'
);
do $$
begin
  execute 'set local role authenticated';
  perform public.join_class(
    '30000000-0000-4000-8000-000000000098',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
  );
  raise exception 'authenticated executed join_class';
exception
  when insufficient_privilege then
    if sqlerrm not like '%permission denied%' then
      raise;
    end if;
end $$;
do $$
declare
  seen integer;
begin
  execute 'set local role service_role';
  perform public.join_class(
    '30000000-0000-4000-8000-000000000098',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
  );
  select count(*) into seen
  from public.class_participants
  where class_id = '30000000-0000-4000-8000-000000000098'
    and user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
    and attendance_status = 'registered';
  if seen <> 1 then
    raise exception 'service_role join created % rows', seen;
  end if;
end $$;
rollback;

\echo 'ADMIN_AUTHZ_SQL_OK'
