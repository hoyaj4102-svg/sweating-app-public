-- Local synthetic proof for 20261122.
-- Anonymous calls are denied. A signed-in admin is still detected.
-- A signed-in member can like, the trigger still rejects a non-participant,
-- and the mutual like still creates one match.
-- Identifiers are generated here. This file has no member data.
-- Do not run against a hosted project.

\set ON_ERROR_STOP on
\ir 30_execute_grants_asserts.sql

create temporary table exec_ids (
  role text primary key,
  id uuid not null
);

insert into exec_ids (role, id)
select role, gen_random_uuid()
from (values
  ('member'),
  ('partner'),
  ('admin'),
  ('outsider'),
  ('gym'),
  ('published'),
  ('draft'),
  ('completed')
) as roles(role);

insert into auth.users (id, email)
select id, role || '@example.test'
from exec_ids
where role in ('member', 'partner', 'admin', 'outsider');

insert into public.profiles (id, display_name, is_admin)
select id, 'Exec ' || initcap(role), role = 'admin'
from exec_ids
where role in ('member', 'partner', 'admin', 'outsider');

insert into public.gyms (id, name, address, city)
select id, 'Exec Gym', 'Local', 'Local'
from exec_ids
where role = 'gym';

insert into public.classes (
  id, gym_id, title, sport_type, scheduled_at, duration_minutes, capacity, price, status
)
select published.id, gym.id, 'exec published', '러닝', now() + interval '2 hours', 60, 8, 0, 'published'
from exec_ids published
join exec_ids gym on gym.role = 'gym'
where published.role = 'published';

insert into public.classes (
  id, gym_id, title, sport_type, scheduled_at, duration_minutes, capacity, price, status
)
select draft.id, gym.id, 'exec draft', '러닝', now() + interval '2 hours', 60, 8, 0, 'draft'
from exec_ids draft
join exec_ids gym on gym.role = 'gym'
where draft.role = 'draft';

insert into public.classes (
  id, gym_id, title, sport_type, scheduled_at, duration_minutes, capacity, price, status
)
select completed.id, gym.id, 'exec completed', '러닝', now() + interval '2 hours', 60, 8, 0, 'published'
from exec_ids completed
join exec_ids gym on gym.role = 'gym'
where completed.role = 'completed';

\echo 'PASS: anon cannot call is_admin or the like trigger'

do $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', 'anon', true);
  execute 'set local role anon';
  perform public.is_admin();
  raise exception 'anon is_admin() succeeded';
exception
  when insufficient_privilege then
    null;
end $$;

do $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', 'anon', true);
  execute 'set local role anon';
  perform public.enforce_like_participants();
  raise exception 'anon enforce_like_participants() succeeded';
exception
  when insufficient_privilege then
    null;
end $$;

\echo 'PASS: anon still reads published classes and not drafts'

do $$
declare
  published_id uuid;
  draft_id uuid;
  seen integer;
begin
  select id into published_id from exec_ids where role = 'published';
  select id into draft_id from exec_ids where role = 'draft';
  execute 'set local role anon';
  select count(*) into seen from public.classes where id = published_id;
  if seen <> 1 then
    raise exception 'anon published count %', seen;
  end if;
  select count(*) into seen from public.classes where id = draft_id;
  if seen <> 0 then
    raise exception 'anon saw a draft';
  end if;
end $$;

\echo 'PASS: signed-in admin detection and draft read still use is_admin()'

do $$
declare
  admin_id uuid;
  member_id uuid;
  draft_id uuid;
  published_id uuid;
  flag boolean;
  seen integer;
  seen_name text;
begin
  select id into admin_id from exec_ids where role = 'admin';
  select id into member_id from exec_ids where role = 'member';
  select id into draft_id from exec_ids where role = 'draft';
  select id into published_id from exec_ids where role = 'published';

  perform set_config('request.jwt.claim.sub', admin_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  select public.is_admin() into flag;
  if flag is distinct from true then
    raise exception 'admin is_admin() returned %', flag;
  end if;
  select count(*) into seen from public.classes where id = draft_id;
  if seen <> 1 then
    raise exception 'admin could not read the draft';
  end if;
  select display_name into seen_name from public.profiles where id = member_id;
  if seen_name is null then
    raise exception 'admin could not read another profile';
  end if;

  perform set_config('request.jwt.claim.sub', member_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  select public.is_admin() into flag;
  if flag is distinct from false then
    raise exception 'member is_admin() returned %', flag;
  end if;
  select count(*) into seen from public.classes where id = draft_id;
  if seen <> 0 then
    raise exception 'member saw a draft';
  end if;
  select count(*) into seen from public.classes where id = published_id;
  if seen <> 1 then
    raise exception 'member published count %', seen;
  end if;
  select display_name into seen_name from public.profiles where id = admin_id;
  if seen_name is not null then
    raise exception 'member read the admin profile';
  end if;
end $$;

\echo 'PASS: signed-in likes still match and the trigger still fires'

do $$
declare
  member_id uuid;
  partner_id uuid;
  class_id uuid;
  joined public.class_participants;
begin
  select id into member_id from exec_ids where role = 'member';
  select id into partner_id from exec_ids where role = 'partner';
  select id into class_id from exec_ids where role = 'completed';
  execute 'set local role service_role';
  joined := public.join_class(class_id, member_id);
  if joined.attendance_status is distinct from 'registered' then
    raise exception 'member join %', joined.attendance_status;
  end if;
  joined := public.join_class(class_id, partner_id);
  if joined.attendance_status is distinct from 'registered' then
    raise exception 'partner join %', joined.attendance_status;
  end if;
end $$;

update public.classes
set scheduled_at = now() - interval '3 hours'
where id = (select id from exec_ids where role = 'completed');

do $$
declare
  admin_id uuid;
  member_id uuid;
  partner_id uuid;
  class_id uuid;
  recorded text;
begin
  select id into admin_id from exec_ids where role = 'admin';
  select id into member_id from exec_ids where role = 'member';
  select id into partner_id from exec_ids where role = 'partner';
  select id into class_id from exec_ids where role = 'completed';
  perform set_config('request.jwt.claim.sub', admin_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  select attendance_status into recorded
  from public.record_attendance(class_id, member_id, 'attended');
  if recorded is distinct from 'attended' then
    raise exception 'member attendance %', recorded;
  end if;
  select attendance_status into recorded
  from public.record_attendance(class_id, partner_id, 'attended');
  if recorded is distinct from 'attended' then
    raise exception 'partner attendance %', recorded;
  end if;
  select status into recorded
  from public.complete_class(class_id);
  if recorded is distinct from 'completed' then
    raise exception 'complete_class %', recorded;
  end if;
end $$;

do $$
declare
  member_id uuid;
  partner_id uuid;
  outsider_id uuid;
  completed_class uuid;
  result jsonb;
  match_count integer;
begin
  select id into member_id from exec_ids where role = 'member';
  select id into partner_id from exec_ids where role = 'partner';
  select id into outsider_id from exec_ids where role = 'outsider';
  select id into completed_class from exec_ids where role = 'completed';

  perform set_config('request.jwt.claim.sub', member_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  result := public.like_participant(completed_class, partner_id);
  if result ->> 'liked' is distinct from 'true' or result ->> 'matched' is distinct from 'false' then
    raise exception 'first like %', result;
  end if;

  perform set_config('request.jwt.claim.sub', partner_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  result := public.like_participant(completed_class, member_id);
  if result ->> 'matched' is distinct from 'true' or result ->> 'match_id' is null then
    raise exception 'second like %', result;
  end if;

  execute 'set local role service_role';
  select count(*) into match_count
  from public.matches as match_row
  where match_row.class_id = completed_class;
  if match_count <> 1 then
    raise exception 'match count %', match_count;
  end if;

  begin
    insert into public.likes (class_id, from_user_id, to_user_id)
    values (completed_class, member_id, outsider_id);
    raise exception 'service_role inserted a like for a non-participant';
  exception
    when others then
      if sqlerrm not like '%participants_only%' then
        raise;
      end if;
  end;
end $$;

\echo 'PASS: anon and signed-in clients still cannot insert likes directly'

do $$
declare
  member_id uuid;
  outsider_id uuid;
  completed_class uuid;
begin
  select id into member_id from exec_ids where role = 'member';
  select id into outsider_id from exec_ids where role = 'outsider';
  select id into completed_class from exec_ids where role = 'completed';
  execute 'set local role anon';
  begin
    insert into public.likes (class_id, from_user_id, to_user_id)
    values (completed_class, member_id, outsider_id);
    raise exception 'anon inserted a like';
  exception
    when insufficient_privilege then
      null;
  end;
end $$;

do $$
declare
  member_id uuid;
  outsider_id uuid;
  completed_class uuid;
begin
  select id into member_id from exec_ids where role = 'member';
  select id into outsider_id from exec_ids where role = 'outsider';
  select id into completed_class from exec_ids where role = 'completed';
  perform set_config('request.jwt.claim.sub', member_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  begin
    insert into public.likes (class_id, from_user_id, to_user_id)
    values (completed_class, member_id, outsider_id);
    raise exception 'authenticated inserted a like directly';
  exception
    when insufficient_privilege then
      null;
  end;
end $$;

\echo 'ANON_SECURITY_DEFINER_EXECUTE_OK'
