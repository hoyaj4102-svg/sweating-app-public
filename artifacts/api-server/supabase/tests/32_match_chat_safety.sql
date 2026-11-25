-- TEST ONLY. Local synthetic proof for 20261125 match chat safety.
-- Identifiers are generated here. This file has no member data.
-- Do not run against a hosted project.

\set ON_ERROR_STOP on

\echo 'PASS: match chat safety grants and RLS stay narrow'

do $$
declare
  fn text;
  tbl text;
begin
  foreach tbl in array array['public.match_chat_blocks', 'public.match_chat_reports'] loop
    if has_table_privilege('anon', tbl, 'SELECT')
       or has_table_privilege('anon', tbl, 'INSERT')
       or has_table_privilege('anon', tbl, 'UPDATE')
       or has_table_privilege('anon', tbl, 'DELETE') then
      raise exception 'anon has privilege on %', tbl;
    end if;
    if not has_table_privilege('authenticated', tbl, 'SELECT') then
      raise exception 'authenticated cannot select %', tbl;
    end if;
    if has_table_privilege('authenticated', tbl, 'INSERT')
       or has_table_privilege('authenticated', tbl, 'UPDATE')
       or has_table_privilege('authenticated', tbl, 'DELETE')
       or has_table_privilege('authenticated', tbl, 'TRUNCATE') then
      raise exception 'authenticated can write % directly', tbl;
    end if;
    if has_table_privilege('service_role', tbl, 'INSERT')
       or has_table_privilege('service_role', tbl, 'UPDATE')
       or has_table_privilege('service_role', tbl, 'DELETE') then
      raise exception 'service_role can write % directly', tbl;
    end if;
    if not (select relrowsecurity from pg_catalog.pg_class where oid = tbl::regclass) then
      raise exception '% has no row level security', tbl;
    end if;
  end loop;

  foreach fn in array array[
    'private.get_match_chat_status(uuid)',
    'private.block_match_chat(uuid)',
    'private.unblock_match_chat(uuid)',
    'private.report_match_chat(uuid,text,text,uuid)',
    'private.send_match_message(uuid,text)',
    'public.get_match_chat_status(uuid)',
    'public.block_match_chat(uuid)',
    'public.unblock_match_chat(uuid)',
    'public.report_match_chat(uuid,text,text,uuid)'
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
end $$;

create temporary table safety_ids (
  role text primary key,
  id uuid not null
);

insert into safety_ids (role, id)
select role, gen_random_uuid()
from (values
  ('member'), ('partner'), ('third'), ('outsider'), ('admin'),
  ('gym'), ('class_a')
) as roles(role);

grant select on safety_ids to authenticated, anon, service_role;

insert into auth.users (id, email)
select id, 'safety-' || role || '@example.test'
from safety_ids
where role in ('member', 'partner', 'third', 'outsider', 'admin');

insert into public.profiles (id, display_name, is_admin)
select id, 'Safety ' || initcap(role), role = 'admin'
from safety_ids
where role in ('member', 'partner', 'third', 'outsider', 'admin');

insert into public.gyms (id, name, address, city)
select id, 'Safety Gym', 'Local', 'Local'
from safety_ids
where role = 'gym';

insert into public.classes (
  id, gym_id, title, sport_type, scheduled_at, duration_minutes, capacity, price, status
)
select c.id, g.id, 'safety class', '러닝', now() + interval '2 hours', 60, 8, 0, 'published'
from safety_ids c
join safety_ids g on g.role = 'gym'
where c.role = 'class_a';

do $$
declare
  v_class uuid := (select id from safety_ids where role = 'class_a');
  v_admin uuid := (select id from safety_ids where role = 'admin');
  person uuid;
begin
  execute 'set local role service_role';
  for person in select id from safety_ids where role in ('member', 'partner', 'third') loop
    perform public.join_class(v_class, person);
  end loop;

  execute 'reset role';
  update public.classes set scheduled_at = now() - interval '3 hours' where id = v_class;
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  for person in select id from safety_ids where role in ('member', 'partner', 'third') loop
    perform public.record_attendance(v_class, person, 'attended');
  end loop;
  perform public.complete_class(v_class);
end $$;

create temporary table safety_matches (
  name text primary key,
  id uuid not null,
  seed_msg uuid
);
grant select on safety_matches to authenticated, anon, service_role;

do $$
declare
  v_class uuid := (select id from safety_ids where role = 'class_a');
  v_member uuid := (select id from safety_ids where role = 'member');
  v_partner uuid := (select id from safety_ids where role = 'partner');
  v_third uuid := (select id from safety_ids where role = 'third');
  res jsonb;
  m1 uuid;
  m2 uuid;
  msg1 public.match_messages;
begin
  perform set_config('request.jwt.claim.sub', v_member::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  perform public.like_participant(v_class, v_partner);

  perform set_config('request.jwt.claim.sub', v_partner::text, true);
  res := public.like_participant(v_class, v_member);
  m1 := (res ->> 'match_id')::uuid;
  msg1 := public.send_match_message(m1, '첫 메시지');

  perform public.like_participant(v_class, v_third);
  perform set_config('request.jwt.claim.sub', v_third::text, true);
  res := public.like_participant(v_class, v_partner);
  m2 := (res ->> 'match_id')::uuid;

  execute 'reset role';
  insert into safety_matches (name, id, seed_msg) values
    ('main', m1, msg1.id),
    ('other', m2, null);
end $$;

\echo 'PASS: blocked sender cannot send and unblock restores sending'

do $$
declare
  v_match uuid := (select id from safety_matches where name = 'main');
  v_member uuid := (select id from safety_ids where role = 'member');
  v_partner uuid := (select id from safety_ids where role = 'partner');
  st jsonb;
  sent public.match_messages;
begin
  perform set_config('request.jwt.claim.sub', v_member::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';

  st := public.get_match_chat_status(v_match);
  if (st ->> 'is_blocked')::boolean or (st ->> 'blocked_by_me')::boolean then
    raise exception 'expected unblocked initially: %', st;
  end if;

  st := public.block_match_chat(v_match);
  if not (st ->> 'is_blocked')::boolean or not (st ->> 'blocked_by_me')::boolean then
    raise exception 'block failed: %', st;
  end if;

  begin
    perform public.send_match_message(v_match, '차단 후 발송');
    raise exception 'blocker sent after blocking';
  exception
    when insufficient_privilege then
      if sqlerrm <> 'match_chat_blocked' then raise; end if;
  end;

  perform set_config('request.jwt.claim.sub', v_partner::text, true);
  st := public.get_match_chat_status(v_match);
  if not (st ->> 'is_blocked')::boolean or (st ->> 'blocked_by_me')::boolean then
    raise exception 'partner status wrong: %', st;
  end if;

  begin
    perform public.send_match_message(v_match, '상대 발송');
    raise exception 'blocked partner sent';
  exception
    when insufficient_privilege then
      if sqlerrm <> 'match_chat_blocked' then raise; end if;
  end;

  begin
    perform public.unblock_match_chat(v_match);
    raise exception 'blocked user unblocked someone else block';
  exception
    when insufficient_privilege then
      if sqlerrm <> 'match_chat_unblock_forbidden' then raise; end if;
  end;

  perform set_config('request.jwt.claim.sub', v_member::text, true);
  st := public.unblock_match_chat(v_match);
  if (st ->> 'is_blocked')::boolean or (st ->> 'blocked_by_me')::boolean then
    raise exception 'unblock failed: %', st;
  end if;

  perform set_config('request.jwt.claim.sub', v_partner::text, true);
  sent := public.send_match_message(v_match, '해제 후 답장');
  if sent.body <> '해제 후 답장' then
    raise exception 'unexpected body %', sent.body;
  end if;
end $$;

\echo 'PASS: third party cannot see blocks or touch the conversation'

do $$
declare
  v_match uuid := (select id from safety_matches where name = 'main');
  v_member uuid := (select id from safety_ids where role = 'member');
  v_partner uuid := (select id from safety_ids where role = 'partner');
  v_third uuid := (select id from safety_ids where role = 'third');
  v_outsider uuid := (select id from safety_ids where role = 'outsider');
  v_admin uuid := (select id from safety_ids where role = 'admin');
  actor uuid;
  seen integer;
begin
  perform set_config('request.jwt.claim.sub', v_member::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  perform public.block_match_chat(v_match);

  -- Only blocker sees their row in match_chat_blocks. Partner, third, outsider, admin see 0.
  select count(*) into seen from public.match_chat_blocks where match_id = v_match;
  if seen <> 1 then
    raise exception 'blocker saw % block rows', seen;
  end if;

  foreach actor in array array[v_partner, v_third, v_outsider, v_admin] loop
    perform set_config('request.jwt.claim.sub', actor::text, true);
    select count(*) into seen from public.match_chat_blocks;
    if seen <> 0 then
      raise exception 'role % saw % block rows', actor, seen;
    end if;
  end loop;

  foreach actor in array array[v_third, v_outsider, v_admin] loop
    perform set_config('request.jwt.claim.sub', actor::text, true);
    begin
      perform public.get_match_chat_status(v_match);
      raise exception 'non-member got status';
    exception when insufficient_privilege then
      if sqlerrm <> 'match_chat_forbidden' then raise; end if;
    end;
    begin
      perform public.block_match_chat(v_match);
      raise exception 'non-member blocked';
    exception when insufficient_privilege then
      if sqlerrm <> 'match_chat_forbidden' then raise; end if;
    end;
    begin
      perform public.report_match_chat(v_match, 'spam', 'x', null);
      raise exception 'non-member reported';
    exception when insufficient_privilege then
      if sqlerrm <> 'match_chat_forbidden' then raise; end if;
    end;
  end loop;

  -- Clean up block for subsequent tests.
  perform set_config('request.jwt.claim.sub', v_member::text, true);
  perform public.unblock_match_chat(v_match);
end $$;

\echo 'PASS: reports are visible only to admins and never to reported user or non-admins'

do $$
declare
  v_match uuid := (select id from safety_matches where name = 'main');
  v_other uuid := (select id from safety_matches where name = 'other');
  v_msg uuid := (select seed_msg from safety_matches where name = 'main');
  v_member uuid := (select id from safety_ids where role = 'member');
  v_partner uuid := (select id from safety_ids where role = 'partner');
  v_third uuid := (select id from safety_ids where role = 'third');
  v_outsider uuid := (select id from safety_ids where role = 'outsider');
  v_admin uuid := (select id from safety_ids where role = 'admin');
  rep1 jsonb;
  rep2 jsonb;
  rep3 jsonb;
  actor uuid;
  seen integer;
begin
  perform set_config('request.jwt.claim.sub', v_member::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';

  rep1 := public.report_match_chat(v_match, 'harassment', '  욕설이 있었어요  ', v_msg);
  rep2 := public.report_match_chat(v_match, 'other', null, null);
  if rep1 ->> 'id' is null or rep2 ->> 'id' is null then
    raise exception 'missing report id';
  end if;

  -- Bad inputs rejected.
  begin
    perform public.report_match_chat(v_match, 'bogus', null, null);
    raise exception 'accepted bogus reason';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.report_match_chat(v_match, 'other', repeat('가', 501), null);
    raise exception 'accepted 501 char detail';
  exception when invalid_parameter_value then null;
  end;
  -- Partner reports in other match (a different report, and checks cross-match message_id rejection).
  perform set_config('request.jwt.claim.sub', v_partner::text, true);
  begin
    perform public.report_match_chat(v_other, 'spam', null, v_msg);
    raise exception 'accepted message_id from another match';
  exception when invalid_parameter_value then null;
  end;
  rep3 := public.report_match_chat(v_other, 'spam', '광고', null);
  if rep3 ->> 'id' is null then
    raise exception 'missing rep3 id';
  end if;

  -- Reporter, reported user, third party, and outsider all see 0 rows in match_chat_reports.
  foreach actor in array array[v_member, v_partner, v_third, v_outsider] loop
    perform set_config('request.jwt.claim.sub', actor::text, true);
    select count(*) into seen from public.match_chat_reports;
    if seen <> 0 then
      raise exception 'non-admin % saw % report rows', actor, seen;
    end if;
  end loop;

  -- Anon denied.
  execute 'set local role anon';
  begin
    perform 1 from public.match_chat_reports;
    raise exception 'anon read reports';
  exception when insufficient_privilege then null;
  end;

  -- Admin sees all 3 reports.
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  select count(*) into seen
  from public.match_chat_reports
  where id in ((rep1 ->> 'id')::uuid, (rep2 ->> 'id')::uuid, (rep3 ->> 'id')::uuid);
  if seen <> 3 then
    raise exception 'admin saw % reports instead of 3', seen;
  end if;
end $$;

\echo 'PASS: send rate limits trigger per minute and per day'

do $$
declare
  v_match uuid := (select id from safety_matches where name = 'main');
  v_other uuid := (select id from safety_matches where name = 'other');
  v_member uuid := (select id from safety_ids where role = 'member');
  v_third uuid := (select id from safety_ids where role = 'third');
  i integer;
begin
  perform set_config('request.jwt.claim.sub', v_member::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';

  for i in 1..10 loop
    perform public.send_match_message(v_match, '속도 테스트 ' || i);
  end loop;

  begin
    perform public.send_match_message(v_match, '11번째 메시지');
    raise exception 'per-minute rate limit did not trigger';
  exception
    when raise_exception then
      if sqlerrm <> 'match_chat_rate_limit_minute' then raise; end if;
  end;

  -- Seed 100 messages 2 hours ago in the second match (outside 1-minute window, inside 1-day window).
  execute 'reset role';
  insert into public.match_messages (match_id, sender_id, body, created_at)
  select v_other, v_third, '이전 메시지 ' || gs, clock_timestamp() - interval '2 hours'
  from generate_series(1, 100) as gs;

  perform set_config('request.jwt.claim.sub', v_third::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';

  begin
    perform public.send_match_message(v_other, '하루 한도 초과');
    raise exception 'per-day rate limit did not trigger';
  exception
    when raise_exception then
      if sqlerrm <> 'match_chat_rate_limit_day' then raise; end if;
  end;
end $$;

\echo 'PASS: deleting match cascades blocks and reports'

do $$
declare
  v_match uuid := (select id from safety_matches where name = 'main');
  v_other uuid := (select id from safety_matches where name = 'other');
  v_member uuid := (select id from safety_ids where role = 'member');
  rem_blocks integer;
  rem_reports integer;
begin
  perform set_config('request.jwt.claim.sub', v_member::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  perform public.block_match_chat(v_match);

  execute 'reset role';
  delete from public.matches where id in (v_match, v_other);

  select count(*) into rem_blocks from public.match_chat_blocks where match_id in (v_match, v_other);
  select count(*) into rem_reports from public.match_chat_reports where match_id in (v_match, v_other);
  if rem_blocks <> 0 or rem_reports <> 0 then
    raise exception 'cascade left blocks=% reports=%', rem_blocks, rem_reports;
  end if;
end $$;

drop table safety_matches;
drop table safety_ids;

\echo 'MATCH_CHAT_SAFETY_OK'
