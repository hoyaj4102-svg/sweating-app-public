-- TEST ONLY. Approved owners can read announcements and acknowledge the
-- current principles version. Everyone else cannot. Do not run on a host.

\set ON_ERROR_STOP on

\echo 'PASS: announcement privileges stay off anon'

do $$
begin
  if has_schema_privilege('anon', 'private', 'USAGE') then
    raise exception 'anon can use the private schema';
  end if;
  if has_schema_privilege('service_role', 'private', 'USAGE') then
    raise exception 'service_role was granted usage on private';
  end if;
  if has_function_privilege('service_role', 'private.is_approved_gym_owner()', 'EXECUTE')
     or has_function_privilege('service_role', 'private.acknowledge_owner_principles(text)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.acknowledge_owner_principles(text)', 'EXECUTE') then
    raise exception 'service_role can execute an announcement function';
  end if;
  if has_function_privilege('anon', 'private.is_approved_gym_owner()', 'EXECUTE')
     or has_function_privilege('anon', 'private.acknowledge_owner_principles(text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.acknowledge_owner_principles(text)', 'EXECUTE') then
    raise exception 'anon can execute an announcement function';
  end if;
  if not has_function_privilege('authenticated', 'private.is_approved_gym_owner()', 'EXECUTE')
     or not has_function_privilege('authenticated', 'private.acknowledge_owner_principles(text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.acknowledge_owner_principles(text)', 'EXECUTE') then
    raise exception 'authenticated cannot execute an announcement function';
  end if;
  if pg_catalog.pg_get_function_identity_arguments('private.is_approved_gym_owner()'::regprocedure) <> ''
     or pg_catalog.pg_get_function_result('private.is_approved_gym_owner()'::regprocedure) <> 'boolean' then
    raise exception 'approved-owner helper is not a no-arg boolean';
  end if;
  if position('auth.uid()' in pg_get_functiondef('private.is_approved_gym_owner()'::regprocedure)) = 0
     or position('email' in pg_get_functiondef('private.is_approved_gym_owner()'::regprocedure)) > 0 then
    raise exception 'approved-owner helper does not stay a yes or no for auth.uid()';
  end if;
  if pg_catalog.pg_get_function_identity_arguments('private.acknowledge_owner_principles(text)'::regprocedure)
       is distinct from 'p_version text'
     or position('auth.uid()' in pg_get_functiondef('private.acknowledge_owner_principles(text)'::regprocedure)) = 0 then
    raise exception 'ack function does not take only a version and auth.uid()';
  end if;
  if (
    select prosecdef
    from pg_catalog.pg_proc functions
    join pg_catalog.pg_namespace schemas on schemas.oid = functions.pronamespace
    where schemas.nspname = 'public'
      and functions.proname = 'acknowledge_owner_principles'
  ) then
    raise exception 'public ack wrapper is security definer';
  end if;
  if not (
    select prosecdef
    from pg_catalog.pg_proc functions
    join pg_catalog.pg_namespace schemas on schemas.oid = functions.pronamespace
    where schemas.nspname = 'private'
      and functions.proname = 'acknowledge_owner_principles'
  ) then
    raise exception 'private ack function is not security definer';
  end if;
  if has_table_privilege('anon', 'public.announcements', 'SELECT')
     or has_table_privilege('anon', 'public.announcements', 'INSERT')
     or has_table_privilege('anon', 'public.owner_notice_acknowledgements', 'SELECT')
     or has_table_privilege('anon', 'public.owner_notice_acknowledgements', 'INSERT')
     or has_table_privilege('authenticated', 'public.announcements', 'INSERT')
     or has_table_privilege('authenticated', 'public.announcements', 'UPDATE')
     or has_table_privilege('authenticated', 'public.announcements', 'DELETE')
     or has_table_privilege('authenticated', 'public.owner_notice_acknowledgements', 'INSERT')
     or has_table_privilege('authenticated', 'public.owner_notice_acknowledgements', 'UPDATE')
     or has_table_privilege('authenticated', 'public.owner_notice_acknowledgements', 'DELETE')
     or has_table_privilege('service_role', 'public.owner_notice_acknowledgements', 'INSERT')
     or has_table_privilege('service_role', 'public.owner_notice_acknowledgements', 'UPDATE')
     or has_table_privilege('service_role', 'public.owner_notice_acknowledgements', 'DELETE')
     or has_table_privilege('service_role', 'public.announcements', 'UPDATE')
     or has_table_privilege('service_role', 'public.announcements', 'DELETE') then
    raise exception 'announcement grants are broader than read for approved owners';
  end if;
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'gym_owners'
      and column_name = 'approved_at'
      and is_nullable = 'YES'
  ) then
    raise exception 'gym_owners.approved_at is missing or not nullable';
  end if;
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'announcements'
      and column_name = 'gym_id'
  ) then
    raise exception 'announcements are not scoped to a gym';
  end if;
  if has_table_privilege('anon', 'public.announcements', 'UPDATE')
     or has_table_privilege('anon', 'public.announcements', 'DELETE')
     or has_table_privilege('anon', 'public.owner_notice_acknowledgements', 'UPDATE')
     or has_table_privilege('anon', 'public.owner_notice_acknowledgements', 'DELETE')
     or has_function_privilege('anon', 'public.protect_announcements()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.protect_announcements()', 'EXECUTE')
     or has_function_privilege('anon', 'private.is_approved_gym_owner()', 'EXECUTE')
     or has_function_privilege('anon', 'private.acknowledge_owner_principles(text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.acknowledge_owner_principles(text)', 'EXECUTE') then
    raise exception 'anon can write announcements or execute an announcement function';
  end if;
  if exists (
    select 1
    from pg_catalog.pg_proc as functions
    join pg_catalog.pg_namespace as schemas on schemas.oid = functions.pronamespace
    where schemas.nspname = 'public'
      and functions.proname = 'protect_announcements'
      and functions.prosecdef
  ) then
    raise exception 'protect_announcements is security definer';
  end if;
  if exists (
    select 1
    from pg_catalog.pg_proc as functions
    join pg_catalog.pg_namespace as schemas on schemas.oid = functions.pronamespace
    where functions.prosecdef
      and schemas.nspname = 'private'
      and functions.proname in ('is_approved_gym_owner', 'acknowledge_owner_principles')
      and (
        functions.proconfig is null
        or position('search_path=""' in pg_catalog.array_to_string(functions.proconfig, ',')) = 0
      )
  ) then
    raise exception 'a security definer announcement function does not pin an empty search_path';
  end if;
end $$;

begin;

insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'member-one@example.com'),
  ('22222222-2222-4222-8222-222222222222', 'member-two@example.com'),
  ('33333333-3333-4333-8333-333333333333', 'owner-unapproved@example.com'),
  ('44444444-4444-4444-8444-444444444444', 'owner-approved@example.com'),
  ('55555555-5555-4555-8555-555555555555', 'owner-other@example.com'),
  ('66666666-6666-4666-8666-666666666666', 'admin-member@example.com'),
  ('77777777-7777-4777-8777-777777777777', 'admin-owner@example.com');

insert into public.profiles (id, display_name, is_admin) values
  ('11111111-1111-4111-8111-111111111111', 'Member One', false),
  ('22222222-2222-4222-8222-222222222222', 'Member Two', false),
  ('33333333-3333-4333-8333-333333333333', 'Unapproved Owner', false),
  ('44444444-4444-4444-8444-444444444444', 'Approved Owner', false),
  ('55555555-5555-4555-8555-555555555555', 'Other Owner', false),
  ('66666666-6666-4666-8666-666666666666', 'Admin Member', true),
  ('77777777-7777-4777-8777-777777777777', 'Admin Owner', true);

insert into public.gyms (id, name, address, city) values
  ('88888888-8888-4888-8888-888888888881', 'Gym Unapproved', 'Busan', 'Busan'),
  ('88888888-8888-4888-8888-888888888882', 'Gym Approved', 'Busan', 'Busan'),
  ('88888888-8888-4888-8888-888888888883', 'Gym Other', 'Busan', 'Busan'),
  ('88888888-8888-4888-8888-888888888884', 'Gym Admin', 'Busan', 'Busan');

insert into public.gym_owners (gym_id, user_id, approved_at) values
  ('88888888-8888-4888-8888-888888888881', '33333333-3333-4333-8333-333333333333', null),
  ('88888888-8888-4888-8888-888888888882', '44444444-4444-4444-8444-444444444444', timestamptz '2026-11-12 18:10:00+09'),
  ('88888888-8888-4888-8888-888888888883', '55555555-5555-4555-8555-555555555555', timestamptz '2026-11-12 18:11:00+09'),
  ('88888888-8888-4888-8888-888888888884', '77777777-7777-4777-8777-777777777777', timestamptz '2026-11-12 18:12:00+09');

\echo 'PASS: existing owner rows are not stamped by a later update'

do $$
begin
  update public.gym_owners
    set approved_at = timestamptz '2026-11-12 18:10:00+09'
    where user_id = '33333333-3333-4333-8333-333333333333';
  raise exception 'approved_at was backfilled';
exception
  when insufficient_privilege then
    if sqlerrm not like '%approved_at_locked%' then
      raise;
    end if;
end $$;

do $$
declare
  stamped timestamptz;
begin
  select approved_at into stamped
  from public.gym_owners
  where user_id = '33333333-3333-4333-8333-333333333333';
  if stamped is not null then
    raise exception 'unapproved owner was stamped';
  end if;
end $$;

do $$
begin
  perform set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', true);
  perform set_config('request.jwt.claim.role', 'service_role', true);
  execute 'set local role service_role';
  update public.gym_owners
    set approved_at = now()
    where user_id = '33333333-3333-4333-8333-333333333333';
  execute 'reset role';
  raise exception 'service role backfilled approved_at';
exception
  when insufficient_privilege then
    execute 'reset role';
    if sqlerrm like '%service role backfilled approved_at%' then
      raise;
    end if;
    if sqlerrm not like '%approved_at_locked%' then
      raise;
    end if;
end $$;

\echo 'PASS: seeded principles text and version are current'

do $$
declare
  seen_title text;
  seen_body text;
  seen_current boolean;
  seen_author uuid;
  seen_published timestamptz;
begin
  select title, body, is_current, author_id, published_at
    into seen_title, seen_body, seen_current, seen_author, seen_published
  from public.announcements
  where notice_version = 'owner-principles-2026-11-12';

  if seen_title is distinct from $principles_title$SWEATING 제휴 체육관 운영 원칙 — 운동으로 시작하는 자연스러운 만남$principles_title$
     or seen_body is distinct from $principles_body$SWEATING의 운동은 단순한 체력 훈련이 아니라, 함께 움직이며 서로를 자연스럽게 알아가는 과정입니다. 관장님께서는 운동 강도나 기록 경쟁보다 두 사람이 대화하고 협력할 수 있는 분위기를 만들어 주세요. 파트너를 바꿔가며 진행하는 순환식 커플 운동을 통해 여러 참가자와 부담 없이 호흡을 맞추고, 서로 응원하며 가까워질 기회를 만드는 것이 운영의 핵심입니다. 신체 접촉과 참여 강도는 각자의 의사를 존중하며, 호감 표현이나 매칭을 강요하지 않습니다.

SWEATING이 지향하는 것은 좋은 만남의 경험이 체육관의 성장으로 이어지는 선순환입니다. 참가자가 운동과 공간에 만족해 자발적인 체험 후기를 남기고, 좋은 인연으로 이어진 분들이 언젠가 “여기서 만나 결혼합니다. 감사합니다”라는 소식을 전할 수 있는 곳을 만들고자 합니다. 이런 진솔한 경험이 쌓이면 체육관은 운동을 배우는 곳을 넘어 좋은 인연이 시작되는 공간으로 기억되고, 입소문과 재방문, 신규 회원 등록으로 이어질 기반이 됩니다.$principles_body$
     or seen_current is distinct from true
     or seen_author is not null
     or seen_published is distinct from timestamptz '2026-11-12 18:10:00+09' then
    raise exception 'principles seed drifted';
  end if;
end $$;

\echo 'PASS: anon, members, unapproved owners, and other users cannot read or ack'

do $$
begin
  execute 'set local role anon';
  perform count(*) from public.announcements;
  execute 'reset role';
  raise exception 'anon read announcements';
exception
  when insufficient_privilege then
    execute 'reset role';
    if sqlerrm like '%anon read announcements%' then
      raise;
    end if;
end $$;

do $$
declare
  actor uuid;
  seen integer;
  answer boolean;
begin
  foreach actor in array array[
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    '33333333-3333-4333-8333-333333333333',
    '66666666-6666-4666-8666-666666666666'
  ]::uuid[]
  loop
    perform set_config('request.jwt.claim.sub', actor::text, true);
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    execute 'set local role authenticated';
    select count(*) into seen from public.announcements;
    if seen <> 0 then
      execute 'reset role';
      raise exception 'caller % read % announcements', actor, seen;
    end if;
    select count(*) into seen from public.owner_notice_acknowledgements;
    select private.is_approved_gym_owner() into answer;
    execute 'reset role';
    if seen <> 0 or answer is distinct from false then
      raise exception 'caller % read an ack or was approved', actor;
    end if;

    perform set_config('request.jwt.claim.sub', actor::text, true);
    execute 'set local role authenticated';
    begin
      perform private.acknowledge_owner_principles('owner-principles-2026-11-12');
      execute 'reset role';
      raise exception 'unapproved caller acknowledged';
    exception
      when others then
        execute 'reset role';
        if sqlerrm like '%unapproved caller acknowledged%' then
          raise;
        end if;
        if sqlerrm not like '%approved_owner_required%' then
          raise;
        end if;
    end;
  end loop;
end $$;

do $$
declare
  seen integer;
begin
  perform set_config('request.jwt.claim.sub', '44444444-4444-4444-8444-444444444444', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  select count(*) into seen from public.gym_owners;
  execute 'reset role';
  if seen <> 0 then
    raise exception 'approved owner read gym_owners';
  end if;
end $$;

\echo 'PASS: approved owner ack is idempotent and a mismatched version is rejected'

do $$
declare
  first_ack timestamptz;
  second_ack timestamptz;
  ack_count integer;
  answer boolean;
begin
  perform set_config('request.jwt.claim.sub', '44444444-4444-4444-8444-444444444444', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  select private.is_approved_gym_owner() into answer;
  select private.acknowledge_owner_principles('owner-principles-2026-11-12') into first_ack;
  select public.acknowledge_owner_principles('owner-principles-2026-11-12') into second_ack;
  execute 'reset role';
  if answer is distinct from true or first_ack is null or first_ack is distinct from second_ack then
    raise exception 'approved ack was not idempotent';
  end if;
  select count(*) into ack_count
  from public.owner_notice_acknowledgements
  where user_id = '44444444-4444-4444-8444-444444444444'
    and notice_version = 'owner-principles-2026-11-12'
    and acknowledged_at = first_ack;
  if ack_count <> 1 then
    raise exception 'expected one ack row, saw %', ack_count;
  end if;
end $$;

do $$
declare
  seen integer;
  actor uuid;
begin
  foreach actor in array array[
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    '55555555-5555-4555-8555-555555555555'
  ]::uuid[]
  loop
    perform set_config('request.jwt.claim.sub', actor::text, true);
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    execute 'set local role authenticated';
    select count(*) into seen from public.owner_notice_acknowledgements;
    execute 'reset role';
    if seen <> 0 then
      raise exception 'caller % read another user acknowledgement', actor;
    end if;
  end loop;
end $$;

do $$
begin
  perform set_config('request.jwt.claim.sub', '44444444-4444-4444-8444-444444444444', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  insert into public.announcements (
    kind, title, body, notice_version, is_current
  ) values (
    'owner_notice',
    '관장 작성',
    '관장은 공지를 직접 쓰지 않습니다.',
    'owner-notice-owner-post',
    false
  );
  execute 'reset role';
  raise exception 'approved owner inserted an announcement';
exception
  when insufficient_privilege then
    execute 'reset role';
    if sqlerrm like '%approved owner inserted an announcement%' then
      raise;
    end if;
end $$;

do $$
begin
  perform set_config('request.jwt.claim.sub', '44444444-4444-4444-8444-444444444444', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  perform private.acknowledge_owner_principles('owner-principles-1999-01-01');
  execute 'reset role';
  raise exception 'mismatched version was accepted';
exception
  when others then
    execute 'reset role';
    if sqlerrm like '%mismatched version was accepted%' then
      raise;
    end if;
    if sqlerrm not like '%principles_version_mismatch%' then
      raise;
    end if;
end $$;

do $$
declare
  ack_count integer;
begin
  select count(*) into ack_count
  from public.owner_notice_acknowledgements
  where notice_version <> 'owner-principles-2026-11-12';
  if ack_count <> 0 then
    raise exception 'version mismatch stored an ack';
  end if;
end $$;

\echo 'PASS: an admin who is an approved owner can ack, and the body cannot change'

do $$
declare
  acked timestamptz;
  seen integer;
begin
  perform set_config('request.jwt.claim.sub', '77777777-7777-4777-8777-777777777777', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  select count(*) into seen from public.announcements where is_current;
  select private.acknowledge_owner_principles('owner-principles-2026-11-12') into acked;
  execute 'reset role';
  if seen <> 1 or acked is null then
    raise exception 'approved admin owner could not read or ack';
  end if;
end $$;

do $$
begin
  update public.announcements
    set body = 'changed'
    where notice_version = 'owner-principles-2026-11-12';
  raise exception 'principles body changed';
exception
  when insufficient_privilege then
    if sqlerrm not like '%announcement_immutable%' then
      raise;
    end if;
end $$;

do $$
declare
  seen_body text;
begin
  select body into seen_body
  from public.announcements
  where notice_version = 'owner-principles-2026-11-12';
  if seen_body not like '%호감 표현이나 매칭을 강요하지 않습니다.%' then
    raise exception 'principles body was replaced';
  end if;
end $$;

do $$
begin
  delete from public.owner_notice_acknowledgements
  where user_id = '44444444-4444-4444-8444-444444444444';
  raise exception 'ack row was deleted';
exception
  when insufficient_privilege then
    if sqlerrm not like '%ack_immutable%' then
      raise;
    end if;
end $$;

do $$
begin
  insert into public.announcements (
    kind, title, body, author_id, notice_version, is_current
  ) values (
    'owner_notice',
    '회원 공지',
    '이 공지는 관리자가 아닙니다.',
    '44444444-4444-4444-8444-444444444444',
    'owner-notice-not-admin',
    false
  );
  raise exception 'non-admin authored a notice';
exception
  when insufficient_privilege then
    if sqlerrm not like '%admin_required%' then
      raise;
    end if;
end $$;

do $$
declare
  created text;
begin
  insert into public.announcements (
    kind, title, body, author_id, notice_version, is_current, published_at
  ) values (
    'owner_notice',
    '시설 점검',
    '이번 주 시설 점검이 있습니다.',
    '66666666-6666-4666-8666-666666666666',
    'owner-notice-fixture',
    true,
    timestamptz '2026-11-12 19:00:00+09'
  )
  returning notice_version into created;
  if created is distinct from 'owner-notice-fixture' then
    raise exception 'admin notice was not stored';
  end if;
  if exists (
    select 1 from public.announcements
    where notice_version = 'owner-notice-fixture' and is_current
  ) then
    raise exception 'owner notice was marked current';
  end if;
end $$;

do $$
declare
  created text;
begin
  execute 'set local role service_role';
  insert into public.announcements (
    kind, title, body, author_id, notice_version, is_current
  ) values (
    'owner_notice',
    '서비스 공지',
    '관리자 API가 서비스 롤로 올립니다.',
    '66666666-6666-4666-8666-666666666666',
    'owner-notice-service',
    false
  )
  returning notice_version into created;
  execute 'reset role';
  if created is distinct from 'owner-notice-service' then
    raise exception 'service role did not store an owner notice';
  end if;
end $$;

do $$
begin
  perform set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  insert into public.announcements (
    kind, title, body, notice_version, is_current
  ) values (
    'owner_notice',
    '가로챈 공지',
    '회원이 직접 씁니다.',
    'owner-notice-member',
    false
  );
  execute 'reset role';
  raise exception 'member inserted an announcement';
exception
  when insufficient_privilege then
    execute 'reset role';
    if sqlerrm like '%member inserted an announcement%' then
      raise;
    end if;
end $$;

insert into public.announcements (
  kind, title, body, notice_version, is_current, published_at
) values (
  'principles',
  '이전 원칙',
  '이전 문구입니다.',
  'owner-principles-2026-01-01',
  false,
  timestamptz '2026-01-01 00:00:00+09'
);

do $$
declare
  still_current text;
begin
  perform set_config('request.jwt.claim.sub', '55555555-5555-4555-8555-555555555555', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  perform private.acknowledge_owner_principles('owner-principles-2026-01-01');
  execute 'reset role';
  raise exception 'old principles version was accepted';
exception
  when others then
    execute 'reset role';
    if sqlerrm like '%old principles version was accepted%' then
      raise;
    end if;
    if sqlerrm not like '%principles_version_mismatch%' then
      raise;
    end if;
end $$;

do $$
declare
  still_current text;
begin
  select notice_version into still_current
  from public.announcements
  where kind = 'principles' and is_current;
  if still_current is distinct from 'owner-principles-2026-11-12' then
    raise exception 'current principles moved to %', still_current;
  end if;
end $$;

grant insert on table public.owner_notice_acknowledgements to service_role;

do $$
begin
  perform set_config('sweating.ack_owner_principles', 'on', true);
  perform set_config('request.jwt.claim.sub', '44444444-4444-4444-8444-444444444444', true);
  perform set_config('request.jwt.claim.role', 'service_role', true);
  execute 'set local role service_role';
  insert into public.owner_notice_acknowledgements (user_id, notice_version)
  values (
    '44444444-4444-4444-8444-444444444444',
    'owner-principles-2026-11-12'
  );
  execute 'reset role';
  raise exception 'service role wrote an ack with the flag set';
exception
  when insufficient_privilege then
    execute 'reset role';
    if sqlerrm like '%service role wrote an ack%' then
      raise;
    end if;
    if sqlerrm not like '%ack_function_required%' and sqlerrm not like '%ack_immutable%' then
      raise;
    end if;
end $$;

rollback;

\echo 'PASS: owner announcement boundaries hold'
