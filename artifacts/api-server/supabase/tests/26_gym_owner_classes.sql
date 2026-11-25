-- TEST ONLY. Owner class writes, roster, and completion stay inside one gym.
-- Do not run against a hosted project.

\set ON_ERROR_STOP on

\echo 'PASS: owner helpers stay off anon and the email lookup stays off authenticated'

do $$
begin
  if has_function_privilege('anon', 'public.is_gym_owner(uuid)', 'EXECUTE') then
    raise exception 'anon can execute is_gym_owner';
  end if;
  if has_function_privilege('anon', 'public.lookup_user_id_by_email(text)', 'EXECUTE') then
    raise exception 'anon can look up an account by email';
  end if;
  if has_function_privilege('authenticated', 'public.lookup_user_id_by_email(text)', 'EXECUTE') then
    raise exception 'authenticated can look up an account by email';
  end if;
  if not has_function_privilege('service_role', 'public.lookup_user_id_by_email(text)', 'EXECUTE') then
    raise exception 'service_role cannot look up an account by email';
  end if;
  if not has_function_privilege('authenticated', 'public.owner_class_roster(uuid)', 'EXECUTE') then
    raise exception 'authenticated cannot read an owner roster';
  end if;
  if has_function_privilege('anon', 'public.owner_class_roster(uuid)', 'EXECUTE') then
    raise exception 'anon can read an owner roster';
  end if;
  if has_table_privilege('authenticated', 'public.gym_owners', 'INSERT')
     or has_table_privilege('authenticated', 'public.gym_owners', 'DELETE') then
    raise exception 'authenticated can write gym_owners';
  end if;
  if has_table_privilege('anon', 'public.classes', 'INSERT')
     or has_table_privilege('anon', 'public.classes', 'UPDATE') then
    raise exception 'anon can write classes';
  end if;

  if position('is_gym_owner' in pg_get_functiondef('public.complete_class(uuid)'::regprocedure)) = 0 then
    raise exception 'complete_class does not allow the gym owner';
  end if;
  if position('payment_status' in pg_get_function_result('public.owner_class_roster(uuid)'::regprocedure)) > 0
     or position('email' in pg_get_function_result('public.owner_class_roster(uuid)'::regprocedure)) > 0 then
    raise exception 'owner roster exposes more than the minimal columns';
  end if;
end $$;

\echo 'PASS: cross-gym class and participant access is denied'

begin;
insert into auth.users (id, email) values
  ('a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1', 'owner-a@example.com'),
  ('b2b2b2b2-b2b2-42b2-82b2-b2b2b2b2b2b2', 'owner-b@example.com'),
  ('c3c3c3c3-c3c3-43c3-83c3-c3c3c3c3c3c3', 'member-c@example.com'),
  ('d4d4d4d4-d4d4-44d4-84d4-d4d4d4d4d4d4', 'admin-d@example.com');
insert into public.profiles (id, display_name, is_admin) values
  ('a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1', 'Owner A', false),
  ('b2b2b2b2-b2b2-42b2-82b2-b2b2b2b2b2b2', 'Owner B', false),
  ('c3c3c3c3-c3c3-43c3-83c3-c3c3c3c3c3c3', 'Member C', false),
  ('d4d4d4d4-d4d4-44d4-84d4-d4d4d4d4d4d4', 'Admin D', true);
insert into public.gyms (id, name, address, city) values
  ('e5e5e5e5-e5e5-45e5-85e5-e5e5e5e5e5e5', 'Gym A', 'Busan', 'Busan'),
  ('f6f6f6f6-f6f6-46f6-86f6-f6f6f6f6f6f6', 'Gym B', 'Busan', 'Busan');
insert into public.gym_owners (gym_id, user_id) values
  ('e5e5e5e5-e5e5-45e5-85e5-e5e5e5e5e5e5', 'a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1'),
  ('f6f6f6f6-f6f6-46f6-86f6-f6f6f6f6f6f6', 'b2b2b2b2-b2b2-42b2-82b2-b2b2b2b2b2b2');
insert into public.classes (
  id, gym_id, title, sport_type, scheduled_at, duration_minutes, capacity, price, status, age_band
) values (
  'b8b8b8b8-b8b8-48b8-88b8-b8b8b8b8b8b8',
  'f6f6f6f6-f6f6-46f6-86f6-f6f6f6f6f6f6',
  'hidden draft',
  '러닝',
  now() + interval '2 days',
  45,
  6,
  0,
  'draft',
  '36_45'
);
insert into public.class_participants (id, class_id, user_id, attendance_status) values (
  'c9c9c9c9-c9c9-49c9-89c9-c9c9c9c9c9c9',
  'b8b8b8b8-b8b8-48b8-88b8-b8b8b8b8b8b8',
  'c3c3c3c3-c3c3-43c3-83c3-c3c3c3c3c3c3',
  'registered'
);

do $$
begin
  perform set_config('request.jwt.claim.sub', 'c3c3c3c3-c3c3-43c3-83c3-c3c3c3c3c3c3', true);
  execute 'set local role authenticated';
  insert into public.classes (
    gym_id, title, sport_type, scheduled_at, duration_minutes, capacity, price, status, age_band
  ) values (
    'e5e5e5e5-e5e5-45e5-85e5-e5e5e5e5e5e5',
    'member class',
    '러닝',
    now() + interval '1 day',
    50,
    8,
    0,
    'published',
    '20_25'
  );
  execute 'reset role';
  raise exception 'member inserted a class';
exception
  when insufficient_privilege or check_violation or raise_exception then
    execute 'reset role';
    if sqlerrm like '%member inserted a class%' then
      raise;
    end if;
    if sqlerrm not like '%row-level security%' then
      raise;
    end if;
end $$;

do $$
begin
  perform set_config('request.jwt.claim.sub', 'a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1', true);
  execute 'set local role authenticated';
  insert into public.classes (
    gym_id, title, sport_type, scheduled_at, duration_minutes, capacity, price, status, age_band
  ) values (
    'f6f6f6f6-f6f6-46f6-86f6-f6f6f6f6f6f6',
    'stolen class',
    '러닝',
    now() + interval '1 day',
    50,
    8,
    0,
    'published',
    '20_25'
  );
  execute 'reset role';
  raise exception 'owner inserted into another gym';
exception
  when insufficient_privilege or check_violation or raise_exception then
    execute 'reset role';
    if sqlerrm like '%owner inserted into another gym%' then
      raise;
    end if;
    if sqlerrm not like '%row-level security%' then
      raise;
    end if;
end $$;

do $$
declare
  created_id uuid;
  created_duration integer;
  created_capacity integer;
  created_band text;
  created_status text;
begin
  perform set_config('request.jwt.claim.sub', 'a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1', true);
  execute 'set local role authenticated';
  insert into public.classes (
    id, gym_id, title, sport_type, scheduled_at, duration_minutes, capacity, price, status, age_band
  ) values (
    'a7a7a7a7-a7a7-47a7-87a7-a7a7a7a7a7a7',
    'e5e5e5e5-e5e5-45e5-85e5-e5e5e5e5e5e5',
    'owner class',
    '러닝',
    now() + interval '1 day',
    75,
    9,
    0,
    'draft',
    '20_25'
  )
  returning id, duration_minutes, capacity, age_band, status
  into created_id, created_duration, created_capacity, created_band, created_status;
  execute 'reset role';
  if created_id is distinct from 'a7a7a7a7-a7a7-47a7-87a7-a7a7a7a7a7a7'
     or created_duration is distinct from 75
     or created_capacity is distinct from 9
     or created_band is distinct from '20_25'
     or created_status is distinct from 'draft' then
    raise exception 'owner insert returned % % % %', created_duration, created_capacity, created_band, created_status;
  end if;
end $$;

do $$
declare
  seen integer;
begin
  perform set_config('request.jwt.claim.sub', 'a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1', true);
  execute 'set local role authenticated';
  select count(*) into seen
  from public.classes
  where id = 'b8b8b8b8-b8b8-48b8-88b8-b8b8b8b8b8b8';
  execute 'reset role';
  if seen <> 0 then
    raise exception 'owner read another gym draft, count %', seen;
  end if;
end $$;

do $$
declare
  seen integer;
begin
  perform set_config('request.jwt.claim.sub', 'b2b2b2b2-b2b2-42b2-82b2-b2b2b2b2b2b2', true);
  execute 'set local role authenticated';
  select count(*) into seen
  from public.classes
  where id = 'b8b8b8b8-b8b8-48b8-88b8-b8b8b8b8b8b8';
  execute 'reset role';
  if seen <> 1 then
    raise exception 'owner could not read own draft, count %', seen;
  end if;
end $$;

do $$
declare
  seen text;
begin
  perform set_config('request.jwt.claim.sub', 'a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1', true);
  execute 'set local role authenticated';
  update public.classes
  set title = 'taken over'
  where id = 'b8b8b8b8-b8b8-48b8-88b8-b8b8b8b8b8b8';
  execute 'reset role';
  select title into seen
  from public.classes
  where id = 'b8b8b8b8-b8b8-48b8-88b8-b8b8b8b8b8b8';
  if seen is distinct from 'hidden draft' then
    raise exception 'cross-gym update changed title to %', seen;
  end if;
end $$;

do $$
begin
  perform set_config('request.jwt.claim.sub', 'a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1', true);
  execute 'set local role authenticated';
  update public.classes
  set gym_id = 'f6f6f6f6-f6f6-46f6-86f6-f6f6f6f6f6f6'
  where id = 'a7a7a7a7-a7a7-47a7-87a7-a7a7a7a7a7a7';
  execute 'reset role';
  raise exception 'owner moved a class to another gym';
exception
  when insufficient_privilege or raise_exception then
    execute 'reset role';
    if sqlerrm like '%owner moved a class%' then
      raise;
    end if;
    if sqlerrm not like '%gym_move_forbidden%' then
      raise;
    end if;
end $$;

do $$
declare
  seen integer;
begin
  perform set_config('request.jwt.claim.sub', 'a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1', true);
  execute 'set local role authenticated';
  select count(*) into seen
  from public.class_participants
  where id = 'c9c9c9c9-c9c9-49c9-89c9-c9c9c9c9c9c9';
  execute 'reset role';
  if seen <> 0 then
    raise exception 'owner read another gym participant, count %', seen;
  end if;
end $$;

do $$
declare
  seen integer;
begin
  perform set_config('request.jwt.claim.sub', 'b2b2b2b2-b2b2-42b2-82b2-b2b2b2b2b2b2', true);
  execute 'set local role authenticated';
  select count(*) into seen
  from public.class_participants
  where class_id = 'b8b8b8b8-b8b8-48b8-88b8-b8b8b8b8b8b8';
  execute 'reset role';
  if seen <> 0 then
    raise exception 'owner read another participant row directly, count %', seen;
  end if;
end $$;

\echo 'PASS: an owner cannot read another participant payment column'

update public.class_participants
set payment_status = 'paid'
where id = 'c9c9c9c9-c9c9-49c9-89c9-c9c9c9c9c9c9';

update public.classes
set status = 'published',
    scheduled_at = now() - interval '30 minutes',
    duration_minutes = 60
where id = 'b8b8b8b8-b8b8-48b8-88b8-b8b8b8b8b8b8';

do $$
declare
  seen text;
begin
  perform set_config('request.jwt.claim.sub', 'b2b2b2b2-b2b2-42b2-82b2-b2b2b2b2b2b2', true);
  execute 'set local role authenticated';
  select payment_status into seen
  from public.class_participants
  where id = 'c9c9c9c9-c9c9-49c9-89c9-c9c9c9c9c9c9';
  execute 'reset role';
  if seen is not null then
    raise exception 'owner selected payment_status %', seen;
  end if;
end $$;

do $$
begin
  perform set_config('request.jwt.claim.sub', 'b2b2b2b2-b2b2-42b2-82b2-b2b2b2b2b2b2', true);
  execute 'set local role authenticated';
  execute 'select payment_status from public.owner_class_roster($1)'
    using 'b8b8b8b8-b8b8-48b8-88b8-b8b8b8b8b8b8'::uuid;
  execute 'reset role';
  raise exception 'roster exposed a payment column';
exception
  when undefined_column then
    execute 'reset role';
end $$;

do $$
declare
  seen text;
begin
  perform set_config('request.jwt.claim.sub', 'c3c3c3c3-c3c3-43c3-83c3-c3c3c3c3c3c3', true);
  execute 'set local role authenticated';
  select payment_status into seen
  from public.class_participants
  where user_id = 'c3c3c3c3-c3c3-43c3-83c3-c3c3c3c3c3c3';
  execute 'reset role';
  if seen is distinct from 'paid' then
    raise exception 'member own payment_status was %', seen;
  end if;
end $$;

do $$
declare
  seen text;
begin
  perform set_config('request.jwt.claim.sub', 'd4d4d4d4-d4d4-44d4-84d4-d4d4d4d4d4d4', true);
  execute 'set local role authenticated';
  select payment_status into seen
  from public.class_participants
  where id = 'c9c9c9c9-c9c9-49c9-89c9-c9c9c9c9c9c9';
  execute 'reset role';
  if seen is distinct from 'paid' then
    raise exception 'admin payment_status was %', seen;
  end if;
end $$;

do $$
declare
  returned text;
  stored text;
begin
  perform set_config('request.jwt.claim.sub', 'b2b2b2b2-b2b2-42b2-82b2-b2b2b2b2b2b2', true);
  execute 'set local role authenticated';
  select payment_status into returned
  from public.record_attendance(
    'b8b8b8b8-b8b8-48b8-88b8-b8b8b8b8b8b8',
    'c3c3c3c3-c3c3-43c3-83c3-c3c3c3c3c3c3',
    'attended'
  );
  execute 'reset role';
  if returned is not null then
    raise exception 'owner attendance rpc returned payment_status %', returned;
  end if;
  select payment_status into stored
  from public.class_participants
  where id = 'c9c9c9c9-c9c9-49c9-89c9-c9c9c9c9c9c9';
  if stored is distinct from 'paid' then
    raise exception 'stored payment_status changed to %', stored;
  end if;
end $$;

do $$
declare
  returned text;
begin
  perform set_config('request.jwt.claim.sub', 'd4d4d4d4-d4d4-44d4-84d4-d4d4d4d4d4d4', true);
  select payment_status into returned
  from public.record_attendance(
    'b8b8b8b8-b8b8-48b8-88b8-b8b8b8b8b8b8',
    'c3c3c3c3-c3c3-43c3-83c3-c3c3c3c3c3c3',
    'attended'
  );
  if returned is distinct from 'paid' then
    raise exception 'admin attendance rpc returned payment_status %', returned;
  end if;
end $$;

do $$
declare
  exposed integer;
begin
  select count(*) into exposed
  from pg_views
  where schemaname = 'public'
    and definition ilike '%payment_status%';
  if exposed <> 0 then
    raise exception 'a public view exposes payment_status';
  end if;
end $$;

do $$
declare
  seen text;
begin
  perform set_config('request.jwt.claim.sub', 'a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1', true);
  execute 'set local role authenticated';
  select display_name into seen
  from public.owner_class_roster('b8b8b8b8-b8b8-48b8-88b8-b8b8b8b8b8b8');
  execute 'reset role';
  raise exception 'cross-gym roster returned %', seen;
exception
  when others then
    execute 'reset role';
    if sqlerrm like '%cross-gym roster returned%' then
      raise;
    end if;
    if sqlerrm not like '%owner_required%' then
      raise;
    end if;
end $$;

do $$
declare
  seen text;
begin
  perform set_config('request.jwt.claim.sub', 'c3c3c3c3-c3c3-43c3-83c3-c3c3c3c3c3c3', true);
  execute 'set local role authenticated';
  select display_name into seen
  from public.owner_class_roster('b8b8b8b8-b8b8-48b8-88b8-b8b8b8b8b8b8');
  execute 'reset role';
  raise exception 'member roster returned %', seen;
exception
  when others then
    execute 'reset role';
    if sqlerrm like '%member roster returned%' then
      raise;
    end if;
    if sqlerrm not like '%owner_required%' then
      raise;
    end if;
end $$;

do $$
declare
  seen text;
begin
  perform set_config('request.jwt.claim.sub', 'b2b2b2b2-b2b2-42b2-82b2-b2b2b2b2b2b2', true);
  execute 'set local role authenticated';
  select display_name into seen
  from public.owner_class_roster('b8b8b8b8-b8b8-48b8-88b8-b8b8b8b8b8b8');
  execute 'reset role';
  if seen is distinct from 'Member C' then
    raise exception 'own roster name was %', seen;
  end if;
end $$;

do $$
begin
  perform set_config('request.jwt.claim.sub', 'c3c3c3c3-c3c3-43c3-83c3-c3c3c3c3c3c3', true);
  execute 'set local role authenticated';
  insert into public.gyms (name, address, city)
  values ('Member Gym', 'Busan', 'Busan');
  execute 'reset role';
  raise exception 'member created a gym';
exception
  when insufficient_privilege or check_violation or raise_exception then
    execute 'reset role';
    if sqlerrm like '%member created a gym%' then
      raise;
    end if;
    if sqlerrm not like '%row-level security%' then
      raise;
    end if;
end $$;

do $$
declare
  created_name text;
begin
  perform set_config('request.jwt.claim.sub', 'd4d4d4d4-d4d4-44d4-84d4-d4d4d4d4d4d4', true);
  execute 'set local role authenticated';
  insert into public.gyms (name, address, city)
  values ('Admin Gym', 'Busan', 'Busan')
  returning name into created_name;
  execute 'reset role';
  if created_name is distinct from 'Admin Gym' then
    raise exception 'admin gym insert returned %', created_name;
  end if;
end $$;

do $$
begin
  perform set_config('request.jwt.claim.sub', 'a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1', true);
  execute 'set local role authenticated';
  insert into public.gym_owners (gym_id, user_id)
  values ('e5e5e5e5-e5e5-45e5-85e5-e5e5e5e5e5e5', 'c3c3c3c3-c3c3-43c3-83c3-c3c3c3c3c3c3');
  execute 'reset role';
  raise exception 'owner rewrote gym_owners';
exception
  when insufficient_privilege then
    execute 'reset role';
    if sqlerrm not like '%permission denied%' then
      raise;
    end if;
end $$;

do $$
declare
  found uuid;
begin
  execute 'set local role service_role';
  found := public.lookup_user_id_by_email('owner-a@example.com');
  execute 'reset role';
  if found is distinct from 'a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1' then
    raise exception 'email lookup returned %', found;
  end if;
  execute 'set local role service_role';
  found := public.lookup_user_id_by_email('missing@example.com');
  execute 'reset role';
  if found is not null then
    raise exception 'missing account lookup returned %', found;
  end if;
end $$;

rollback;

\echo 'PASS: only the owning host or an admin can complete, and only after the end'

begin;
insert into auth.users (id, email) values
  ('a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1', 'owner-a@example.com'),
  ('b2b2b2b2-b2b2-42b2-82b2-b2b2b2b2b2b2', 'owner-b@example.com'),
  ('c3c3c3c3-c3c3-43c3-83c3-c3c3c3c3c3c3', 'member-c@example.com'),
  ('d4d4d4d4-d4d4-44d4-84d4-d4d4d4d4d4d4', 'admin-d@example.com');
insert into public.profiles (id, display_name, is_admin) values
  ('a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1', 'Owner A', false),
  ('b2b2b2b2-b2b2-42b2-82b2-b2b2b2b2b2b2', 'Owner B', false),
  ('c3c3c3c3-c3c3-43c3-83c3-c3c3c3c3c3c3', 'Member C', false),
  ('d4d4d4d4-d4d4-44d4-84d4-d4d4d4d4d4d4', 'Admin D', true);
insert into public.gyms (id, name, address, city) values
  ('e5e5e5e5-e5e5-45e5-85e5-e5e5e5e5e5e5', 'Gym A', 'Busan', 'Busan'),
  ('f6f6f6f6-f6f6-46f6-86f6-f6f6f6f6f6f6', 'Gym B', 'Busan', 'Busan');
insert into public.gym_owners (gym_id, user_id) values
  ('e5e5e5e5-e5e5-45e5-85e5-e5e5e5e5e5e5', 'a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1'),
  ('f6f6f6f6-f6f6-46f6-86f6-f6f6f6f6f6f6', 'b2b2b2b2-b2b2-42b2-82b2-b2b2b2b2b2b2');
insert into public.classes (
  id, gym_id, title, sport_type, scheduled_at, duration_minutes, capacity, price, status, age_band
) values (
  'a7a7a7a7-a7a7-47a7-87a7-a7a7a7a7a7a7',
  'e5e5e5e5-e5e5-45e5-85e5-e5e5e5e5e5e5',
  'owner class',
  '러닝',
  now() + interval '2 hours',
  60,
  8,
  0,
  'published',
  '20_25'
);

do $$
begin
  perform set_config('request.jwt.claim.sub', 'a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1', true);
  perform public.complete_class('a7a7a7a7-a7a7-47a7-87a7-a7a7a7a7a7a7');
  raise exception 'owner completed before the end';
exception
  when others then
    if sqlerrm like '%owner completed before the end%' then
      raise;
    end if;
    if sqlerrm not like '%class_not_finished%' then
      raise;
    end if;
end $$;

do $$
begin
  perform set_config('request.jwt.claim.sub', 'c3c3c3c3-c3c3-43c3-83c3-c3c3c3c3c3c3', true);
  perform public.complete_class('a7a7a7a7-a7a7-47a7-87a7-a7a7a7a7a7a7');
  raise exception 'member completed a class';
exception
  when others then
    if sqlerrm like '%member completed a class%' then
      raise;
    end if;
    if sqlerrm not like '%admin_required%' then
      raise;
    end if;
end $$;

do $$
begin
  perform set_config('request.jwt.claim.sub', 'b2b2b2b2-b2b2-42b2-82b2-b2b2b2b2b2b2', true);
  perform public.complete_class('a7a7a7a7-a7a7-47a7-87a7-a7a7a7a7a7a7');
  raise exception 'other owner completed a class';
exception
  when others then
    if sqlerrm like '%other owner completed a class%' then
      raise;
    end if;
    if sqlerrm not like '%admin_required%' then
      raise;
    end if;
end $$;

update public.classes
set scheduled_at = now() - interval '3 hours'
where id = 'a7a7a7a7-a7a7-47a7-87a7-a7a7a7a7a7a7';

do $$
declare
  seen text;
begin
  perform set_config('request.jwt.claim.sub', 'a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1', true);
  select status into seen
  from public.complete_class('a7a7a7a7-a7a7-47a7-87a7-a7a7a7a7a7a7');
  if seen is distinct from 'completed' then
    raise exception 'owner complete after end returned %', seen;
  end if;
end $$;

rollback;

\echo 'PASS: gym owner class boundaries hold'
