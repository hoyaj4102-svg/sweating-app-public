-- TEST ONLY. Proves the pre-fix grants. Do not run against production.
\set ON_ERROR_STOP on

\echo 'PASS: before the fix, anon and authenticated can insert, update, and truncate class_participants'

do $$
declare
  role_name text;
  privilege text;
begin
  foreach role_name in array array['anon', 'authenticated']
  loop
    foreach privilege in array array['INSERT', 'UPDATE', 'TRUNCATE']
    loop
      if not has_table_privilege(role_name, 'public.class_participants', privilege) then
        raise exception 'expected % to have % on class_participants before the fix', role_name, privilege;
      end if;
    end loop;
  end loop;
  if to_regprocedure('public.mark_attendance(uuid,uuid,text)') is not null then
    raise exception 'mark_attendance is not part of this branch';
  end if;
end $$;

\echo 'PASS: before the fix, a client can set attendance when row level security is off'

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
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', true);
update public.class_participants
  set attendance_status = 'attended'
  where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
reset role;
do $$
declare
  seen text;
begin
  select attendance_status into seen
  from public.class_participants
  where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
  if seen is distinct from 'attended' then
    raise exception 'pre-fix attendance write failed, got %', seen;
  end if;
end $$;
rollback;

\echo 'PASS: before the fix, a client can set their own is_admin'

begin;
insert into auth.users (id, email) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'user@example.com');
insert into public.profiles (id, display_name, is_admin) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'User', false);
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', true);
update public.profiles
  set is_admin = true
  where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
reset role;
do $$
declare
  flag boolean;
begin
  select is_admin into flag
  from public.profiles
  where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
  if flag is distinct from true then
    raise exception 'pre-fix is_admin write failed, got %', flag;
  end if;
end $$;
rollback;

\echo 'BEFORE_CLIENT_WRITES_OK'
