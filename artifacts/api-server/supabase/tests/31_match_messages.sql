-- TEST ONLY. Local synthetic proof for 20261124 match messages.
-- Identifiers are generated here. This file has no member data.
-- Do not run against a hosted project.

\set ON_ERROR_STOP on

\echo 'PASS: match message grants stay narrow'

do $$
declare
  fn text;
begin
  if has_table_privilege('anon', 'public.match_messages', 'SELECT')
     or has_table_privilege('anon', 'public.match_messages', 'INSERT')
     or has_table_privilege('anon', 'public.match_messages', 'UPDATE')
     or has_table_privilege('anon', 'public.match_messages', 'DELETE') then
    raise exception 'anon has a privilege on match_messages';
  end if;
  if not has_table_privilege('authenticated', 'public.match_messages', 'SELECT') then
    raise exception 'authenticated cannot select match_messages';
  end if;
  if has_table_privilege('authenticated', 'public.match_messages', 'INSERT')
     or has_table_privilege('authenticated', 'public.match_messages', 'UPDATE')
     or has_table_privilege('authenticated', 'public.match_messages', 'DELETE')
     or has_table_privilege('authenticated', 'public.match_messages', 'TRUNCATE') then
    raise exception 'authenticated can write match_messages directly';
  end if;
  if has_table_privilege('service_role', 'public.match_messages', 'INSERT')
     or has_table_privilege('service_role', 'public.match_messages', 'UPDATE')
     or has_table_privilege('service_role', 'public.match_messages', 'DELETE') then
    raise exception 'service_role can write match_messages directly';
  end if;
  if not (select relrowsecurity from pg_catalog.pg_class where oid = 'public.match_messages'::regclass) then
    raise exception 'match_messages has no row level security';
  end if;
  if exists (
    select 1 from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'match_messages'
      and (cmd <> 'SELECT' or roles <> array['authenticated']::name[])
  ) then
    raise exception 'match_messages has a policy other than authenticated select';
  end if;

  foreach fn in array array[
    'private.can_use_match_chat(uuid)',
    'private.list_match_messages(uuid,integer,timestamp with time zone)',
    'private.send_match_message(uuid,text)',
    'public.list_match_messages(uuid,integer,timestamp with time zone)',
    'public.send_match_message(uuid,text)'
  ] loop
    if has_function_privilege('anon', fn, 'EXECUTE') then
      raise exception 'anon can execute %', fn;
    end if;
    if has_function_privilege('service_role', fn, 'EXECUTE') then
      raise exception 'service_role can execute %', fn;
    end if;
    if not has_function_privilege('authenticated', fn, 'EXECUTE') then
      raise exception 'authenticated cannot execute %', fn;
    end if;
    if (select coalesce(proconfig, '{}'::text[]) from pg_catalog.pg_proc where oid = fn::regprocedure)
       is distinct from array['search_path=""']::text[] then
      raise exception '% does not pin an empty search_path', fn;
    end if;
    if (select prosecdef from pg_catalog.pg_proc where oid = fn::regprocedure)
       is distinct from (fn like 'private.%') then
      raise exception '% has the wrong security mode', fn;
    end if;
  end loop;

  if has_schema_privilege('anon', 'private', 'USAGE') then
    raise exception 'anon can use the private schema';
  end if;
end $$;

create temporary table msg_ids (
  role text primary key,
  id uuid not null
);

insert into msg_ids (role, id)
select role, gen_random_uuid()
from (values
  ('member'), ('partner'), ('third'), ('outsider'), ('admin'),
  ('gym'), ('chat_class'), ('pending_class'), ('pending_match')
) as roles(role);

-- Temporary test tables only. Lets the loops below read ids after SET ROLE.
grant select on msg_ids to authenticated, anon, service_role;

insert into auth.users (id, email)
select id, 'msg-' || role || '@example.test'
from msg_ids
where role in ('member', 'partner', 'third', 'outsider', 'admin');

insert into public.profiles (id, display_name, is_admin)
select id, 'Msg ' || initcap(role), role = 'admin'
from msg_ids
where role in ('member', 'partner', 'third', 'outsider', 'admin');

insert into public.gyms (id, name, address, city)
select id, 'Msg Gym', 'Local', 'Local'
from msg_ids
where role = 'gym';

insert into public.classes (
  id, gym_id, title, sport_type, scheduled_at, duration_minutes, capacity, price, status
)
select c.id, g.id, 'msg ' || c.role, '러닝', now() + interval '2 hours', 60, 8, 0, 'published'
from msg_ids c
join msg_ids g on g.role = 'gym'
where c.role in ('chat_class', 'pending_class');

do $$
declare
  class_id uuid;
  pending_id uuid;
  person uuid;
begin
  select id into class_id from msg_ids where role = 'chat_class';
  select id into pending_id from msg_ids where role = 'pending_class';
  execute 'set local role service_role';
  for person in select id from msg_ids where role in ('member', 'partner', 'third') loop
    perform public.join_class(class_id, person);
  end loop;
  for person in select id from msg_ids where role in ('member', 'partner') loop
    perform public.join_class(pending_id, person);
  end loop;
end $$;

update public.classes
set scheduled_at = now() - interval '3 hours'
where id = (select id from msg_ids where role = 'chat_class');

do $$
declare
  admin_id uuid;
  class_id uuid;
  person uuid;
  recorded text;
begin
  select id into admin_id from msg_ids where role = 'admin';
  select id into class_id from msg_ids where role = 'chat_class';
  perform set_config('request.jwt.claim.sub', admin_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  for person in select id from msg_ids where role in ('member', 'partner', 'third') loop
    select attendance_status into recorded from public.record_attendance(class_id, person, 'attended');
    if recorded is distinct from 'attended' then
      raise exception 'attendance %', recorded;
    end if;
  end loop;
  select status into recorded from public.complete_class(class_id);
  if recorded is distinct from 'completed' then
    raise exception 'complete_class %', recorded;
  end if;
end $$;

create temporary table msg_match (id uuid not null);
grant select on msg_match to authenticated, anon, service_role;

do $$
declare
  member_id uuid;
  partner_id uuid;
  class_id uuid;
  result jsonb;
begin
  select id into member_id from msg_ids where role = 'member';
  select id into partner_id from msg_ids where role = 'partner';
  select id into class_id from msg_ids where role = 'chat_class';
  perform set_config('request.jwt.claim.sub', member_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  result := public.like_participant(class_id, partner_id);
  perform set_config('request.jwt.claim.sub', partner_id::text, true);
  result := public.like_participant(class_id, member_id);
  if result ->> 'matched' is distinct from 'true' then
    raise exception 'no match %', result;
  end if;
  execute 'reset role';
  insert into msg_match (id) values ((result ->> 'match_id')::uuid);
end $$;

-- A match row for a class that has not finished. Written by the test owner
-- only, to prove the class gate. The app never creates this.
insert into public.matches (id, class_id, user_a_id, user_b_id)
select pm.id, pc.id, least(m.id, p.id), greatest(m.id, p.id)
from msg_ids pm, msg_ids pc, msg_ids m, msg_ids p
where pm.role = 'pending_match' and pc.role = 'pending_class'
  and m.role = 'member' and p.role = 'partner';

\echo 'PASS: a matched pair can send and read'

do $$
declare
  member_id uuid := (select id from msg_ids where role = 'member');
  partner_id uuid := (select id from msg_ids where role = 'partner');
  v_match uuid := (select id from msg_match);
  sent public.match_messages;
  seen integer;
  latest text;
begin
  perform set_config('request.jwt.claim.sub', member_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  sent := public.send_match_message(v_match, '  안녕하세요, 오늘 즐거웠어요  ');
  if sent.sender_id is distinct from member_id or sent.body <> '안녕하세요, 오늘 즐거웠어요' then
    raise exception 'member send stored % / %', sent.sender_id, sent.body;
  end if;

  perform set_config('request.jwt.claim.sub', partner_id::text, true);
  select count(*) into seen from public.list_match_messages(v_match);
  if seen <> 1 then
    raise exception 'partner list count %', seen;
  end if;
  sent := public.send_match_message(v_match, '저도요!');
  if sent.sender_id is distinct from partner_id then
    raise exception 'partner send sender %', sent.sender_id;
  end if;
  select count(*) into seen from public.match_messages where match_messages.match_id = v_match;
  if seen <> 2 then
    raise exception 'partner RLS read count %', seen;
  end if;

  perform set_config('request.jwt.claim.sub', member_id::text, true);
  select body into latest from public.list_match_messages(v_match, 1) limit 1;
  if latest is distinct from '저도요!' then
    raise exception 'member newest message %', latest;
  end if;
  select count(*) into seen from public.match_messages;
  if seen <> 2 then
    raise exception 'member RLS read count %', seen;
  end if;
end $$;

\echo 'PASS: a non-member cannot read or send'

do $$
declare
  v_match uuid := (select id from msg_match);
  actor uuid;
  seen integer;
begin
  for actor in select id from msg_ids where role in ('third', 'outsider', 'admin') loop
    perform set_config('request.jwt.claim.sub', actor::text, true);
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    execute 'set local role authenticated';
    begin
      perform public.list_match_messages(v_match);
      raise exception 'non-member listed messages';
    exception
      when insufficient_privilege then
        if sqlerrm <> 'match_chat_forbidden' then raise; end if;
    end;
    begin
      perform public.send_match_message(v_match, '끼어들기');
      raise exception 'non-member sent a message';
    exception
      when insufficient_privilege then
        if sqlerrm <> 'match_chat_forbidden' then raise; end if;
    end;
    select count(*) into seen from public.match_messages;
    if seen <> 0 then
      raise exception 'non-member read % rows through RLS', seen;
    end if;
    begin
      insert into public.match_messages (match_id, sender_id, body) values (v_match, actor, 'direct');
      raise exception 'non-member inserted directly';
    exception
      when insufficient_privilege then null;
    end;
  end loop;
end $$;

\echo 'PASS: anon is denied'

do $$
declare
  v_match uuid := (select id from msg_match);
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', 'anon', true);
  execute 'set local role anon';
  begin
    perform public.list_match_messages(v_match);
    raise exception 'anon listed messages';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.send_match_message(v_match, 'anon');
    raise exception 'anon sent a message';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.match_messages;
    raise exception 'anon read match_messages';
  exception when insufficient_privilege then null;
  end;
  begin
    perform private.can_use_match_chat(v_match);
    raise exception 'anon called the chat helper';
  exception when insufficient_privilege then null;
  end;
end $$;

\echo 'PASS: service_role cannot write or call the chat functions'

do $$
declare
  v_match uuid := (select id from msg_match);
  member_id uuid := (select id from msg_ids where role = 'member');
begin
  perform set_config('request.jwt.claim.sub', member_id::text, true);
  perform set_config('request.jwt.claim.role', 'service_role', true);
  execute 'set local role service_role';
  begin
    insert into public.match_messages (match_id, sender_id, body) values (v_match, member_id, 'svc');
    raise exception 'service_role inserted a message';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.send_match_message(v_match, 'svc');
    raise exception 'service_role sent through the wrapper';
  exception when insufficient_privilege then null;
  end;
end $$;

\echo 'PASS: an unmatched pair is denied'

do $$
declare
  member_id uuid := (select id from msg_ids where role = 'member');
  third_id uuid := (select id from msg_ids where role = 'third');
  pending_match uuid := (select id from msg_ids where role = 'pending_match');
  actor uuid;
begin
  -- member and third attended the same class but never matched. There is
  -- no conversation id for them; any other id is refused.
  foreach actor in array array[member_id, third_id] loop
    perform set_config('request.jwt.claim.sub', actor::text, true);
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    execute 'set local role authenticated';
    begin
      perform public.send_match_message(gen_random_uuid(), '없는 대화');
      raise exception 'sent to a match id that does not exist';
    exception
      when insufficient_privilege then
        if sqlerrm <> 'match_chat_forbidden' then raise; end if;
    end;
    begin
      perform public.send_match_message(null, 'null');
      raise exception 'sent to a null match id';
    exception
      when insufficient_privilege then
        if sqlerrm <> 'match_chat_forbidden' then raise; end if;
    end;
  end loop;

  -- A match row whose class has not finished stays closed.
  perform set_config('request.jwt.claim.sub', member_id::text, true);
  begin
    perform public.send_match_message(pending_match, '아직');
    raise exception 'sent before the class ended';
  exception
    when insufficient_privilege then
      if sqlerrm <> 'match_chat_forbidden' then raise; end if;
  end;
end $$;

\echo 'PASS: message length limit'

do $$
declare
  member_id uuid := (select id from msg_ids where role = 'member');
  v_match uuid := (select id from msg_match);
  sent public.match_messages;
  bad text;
begin
  perform set_config('request.jwt.claim.sub', member_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  sent := public.send_match_message(v_match, repeat('가', 1000));
  if char_length(sent.body) <> 1000 then
    raise exception '1000 character body stored as %', char_length(sent.body);
  end if;
  foreach bad in array array[repeat('가', 1001), '', E'  \n\t  '] loop
    begin
      perform public.send_match_message(v_match, bad);
      raise exception 'accepted a body of % characters', char_length(bad);
    exception
      when invalid_parameter_value then
        if sqlerrm <> 'message_invalid' then raise; end if;
    end;
  end loop;
  begin
    perform public.send_match_message(v_match, null);
    raise exception 'accepted a null body';
  exception
    when invalid_parameter_value then null;
  end;
end $$;

do $$
begin
  insert into public.match_messages (match_id, sender_id, body)
  values ((select id from msg_match), (select id from msg_ids where role = 'member'), repeat('x', 1001));
  raise exception 'the table accepted a 1001 character body';
exception
  when check_violation then null;
end $$;

\echo 'PASS: a pair whose attendance was reversed is blocked'

do $$
declare
  v_class uuid := (select id from msg_ids where role = 'chat_class');
  partner_id uuid := (select id from msg_ids where role = 'partner');
begin
  perform set_config('sweating.recording_attendance', 'on', true);
  update public.class_participants
  set attendance_status = 'no_show'
  where class_participants.class_id = v_class
    and user_id = partner_id;
end $$;

do $$
declare
  v_match uuid := (select id from msg_match);
  actor uuid;
  seen integer;
begin
  for actor in select id from msg_ids where role in ('member', 'partner') loop
    perform set_config('request.jwt.claim.sub', actor::text, true);
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    execute 'set local role authenticated';
    begin
      perform public.send_match_message(v_match, '닫힌 대화');
      raise exception 'sent after attendance was reversed';
    exception
      when insufficient_privilege then
        if sqlerrm <> 'match_chat_forbidden' then raise; end if;
    end;
    begin
      perform public.list_match_messages(v_match);
      raise exception 'listed after attendance was reversed';
    exception
      when insufficient_privilege then
        if sqlerrm <> 'match_chat_forbidden' then raise; end if;
    end;
    select count(*) into seen from public.match_messages;
    if seen <> 0 then
      raise exception 'RLS still returned % rows after reversal', seen;
    end if;
  end loop;
end $$;

\echo 'PASS: messages go away with their match'

do $$
declare
  v_match uuid := (select id from msg_match);
  left_over integer;
begin
  delete from public.matches where id = v_match;
  select count(*) into left_over from public.match_messages where match_messages.match_id = v_match;
  if left_over <> 0 then
    raise exception 'messages survived their match: %', left_over;
  end if;
end $$;

drop table msg_match;
drop table msg_ids;

\echo 'MATCH_MESSAGES_OK'
