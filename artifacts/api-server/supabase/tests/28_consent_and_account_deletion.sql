-- TEST ONLY. Consent is required, versions are stored, and account deletion
-- removes the caller only. Do not run against a hosted project.

\set ON_ERROR_STOP on

delete from auth.users where id in (
  'a0a0a0a0-a0a0-40a0-80a0-a0a0a0a0a0a0',
  'b0b0b0b0-b0b0-40b0-80b0-b0b0b0b0b0b0',
  'c0c0c0c0-c0c0-40c0-80c0-c0c0c0c0c0c0',
  'd0d0d0d0-d0d0-40d0-80d0-d0d0d0d0d0d0',
  'e0e0e0e0-e0e0-40e0-80e0-e0e0e0e0e0e0'
);

insert into auth.users (id, email) values
  ('e0e0e0e0-e0e0-40e0-80e0-e0e0e0e0e0e0', 'consent-member@example.test'),
  ('a0a0a0a0-a0a0-40a0-80a0-a0a0a0a0a0a0', 'delete-self@example.test'),
  ('b0b0b0b0-b0b0-40b0-80b0-b0b0b0b0b0b0', 'delete-other@example.test'),
  ('d0d0d0d0-d0d0-40d0-80d0-d0d0d0d0d0d0', 'delete-third@example.test'),
  ('c0c0c0c0-c0c0-40c0-80c0-c0c0c0c0c0c0', 'delete-owner@example.test');

\echo 'PASS consent: version is the draft document version'

do $$
begin
  if public.current_consent_version() is distinct from '2026-11-12' then
    raise exception 'consent version drifted: %', public.current_consent_version();
  end if;
end $$;

\echo 'PASS consent: an authenticated profile insert without consent is rejected'

do $$
begin
  perform set_config('request.jwt.claim.sub', 'e0e0e0e0-e0e0-40e0-80e0-e0e0e0e0e0e0', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  insert into public.profiles (id, display_name)
  values ('e0e0e0e0-e0e0-40e0-80e0-e0e0e0e0e0e0', 'No Consent');
  raise exception 'profile insert without consent succeeded';
exception
  when others then
    if sqlerrm like '%profile insert without consent succeeded%' then
      raise;
    end if;
    if sqlerrm not like '%consent_required%' then
      raise;
    end if;
end $$;

\echo 'PASS consent: a partial acceptance is rejected and stores nothing'

do $$
begin
  perform set_config('request.jwt.claim.sub', 'e0e0e0e0-e0e0-40e0-80e0-e0e0e0e0e0e0', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  perform public.record_own_consents(true, true, false);
  raise exception 'partial consent succeeded';
exception
  when others then
    if sqlerrm like '%partial consent succeeded%' then
      raise;
    end if;
    if sqlerrm not like '%consent_required%' then
      raise;
    end if;
end $$;

do $$
declare
  seen integer;
begin
  select count(*) into seen
  from public.user_consents
  where user_id = 'e0e0e0e0-e0e0-40e0-80e0-e0e0e0e0e0e0';
  if seen <> 0 then
    raise exception 'partial consent stored % rows', seen;
  end if;
end $$;

\echo 'PASS consent: current version and timestamp are stored once'

do $$
declare
  seen integer;
  stale integer;
begin
  perform set_config('request.jwt.claim.sub', 'e0e0e0e0-e0e0-40e0-80e0-e0e0e0e0e0e0', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  perform public.record_own_consents(true, true, true);
  perform public.record_own_consents(true, true, true);

  select count(*) into seen
  from public.user_consents
  where user_id = 'e0e0e0e0-e0e0-40e0-80e0-e0e0e0e0e0e0'
    and version = public.current_consent_version()
    and accepted_at is not null
    and accepted_at <= now()
    and accepted_at > now() - interval '5 minutes'
    and kind in ('terms', 'privacy', 'overseas_transfer');
  if seen <> 3 then
    raise exception 'current consents were %, expected 3', seen;
  end if;

  select count(*) into stale
  from public.user_consents
  where user_id = 'e0e0e0e0-e0e0-40e0-80e0-e0e0e0e0e0e0'
    and version is distinct from public.current_consent_version();
  if stale <> 0 then
    raise exception 'record_own_consents stored a non-current version';
  end if;
end $$;

do $$
begin
  perform set_config('request.jwt.claim.sub', 'e0e0e0e0-e0e0-40e0-80e0-e0e0e0e0e0e0', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  insert into public.profiles (id, display_name)
  values ('e0e0e0e0-e0e0-40e0-80e0-e0e0e0e0e0e0', 'Consented');
end $$;

\echo 'PASS consent: an old version does not unlock a profile write'

do $$
begin
  insert into public.user_consents (user_id, kind, version)
  select 'a0a0a0a0-a0a0-40a0-80a0-a0a0a0a0a0a0', kind, '1999-01-01'
  from (values ('terms'), ('privacy'), ('overseas_transfer')) as required(kind);

  perform set_config('request.jwt.claim.sub', 'a0a0a0a0-a0a0-40a0-80a0-a0a0a0a0a0a0', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  insert into public.profiles (id, display_name)
  values ('a0a0a0a0-a0a0-40a0-80a0-a0a0a0a0a0a0', 'Stale Consent');
  raise exception 'stale consent allowed a profile';
exception
  when others then
    if sqlerrm like '%stale consent allowed a profile%' then
      raise;
    end if;
    if sqlerrm not like '%consent_required%' then
      raise;
    end if;
end $$;

\echo 'PASS consent: a member cannot insert another member consent'

do $$
begin
  perform set_config('request.jwt.claim.sub', 'e0e0e0e0-e0e0-40e0-80e0-e0e0e0e0e0e0', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  insert into public.user_consents (user_id, kind, version)
  values ('b0b0b0b0-b0b0-40b0-80b0-b0b0b0b0b0b0', 'terms', '2026-11-12');
  raise exception 'cross-user consent insert succeeded';
exception
  when insufficient_privilege then
    null;
end $$;

\echo 'PASS deletion: setup two members, a past class, and a future class'

insert into public.user_consents (user_id, kind, version)
select user_id, kind, public.current_consent_version()
from (
  values
    ('a0a0a0a0-a0a0-40a0-80a0-a0a0a0a0a0a0'::uuid),
    ('b0b0b0b0-b0b0-40b0-80b0-b0b0b0b0b0b0'::uuid),
    ('d0d0d0d0-d0d0-40d0-80d0-d0d0d0d0d0d0'::uuid),
    ('c0c0c0c0-c0c0-40c0-80c0-c0c0c0c0c0c0'::uuid)
) as members(user_id)
cross join (values ('terms'), ('privacy'), ('overseas_transfer')) as required(kind);

insert into public.profiles (id, display_name) values
  ('a0a0a0a0-a0a0-40a0-80a0-a0a0a0a0a0a0', 'Self'),
  ('b0b0b0b0-b0b0-40b0-80b0-b0b0b0b0b0b0', 'Other'),
  ('d0d0d0d0-d0d0-40d0-80d0-d0d0d0d0d0d0', 'Third'),
  ('c0c0c0c0-c0c0-40c0-80c0-c0c0c0c0c0c0', 'Owner');

insert into public.gyms (id, name, address, city) values
  ('10000000-0000-4000-8000-0000000000c1', 'Past Gym', 'Busan', 'Busan'),
  ('10000000-0000-4000-8000-0000000000c2', 'Future Gym', 'Busan', 'Busan');

insert into public.classes (
  id, gym_id, title, sport_type, scheduled_at, duration_minutes, capacity, price, status
) values
  (
    '30000000-0000-4000-8000-0000000000c1',
    '10000000-0000-4000-8000-0000000000c1',
    'past class',
    '러닝',
    now() - interval '2 days',
    60,
    8,
    0,
    'completed'
  ),
  (
    '30000000-0000-4000-8000-0000000000c2',
    '10000000-0000-4000-8000-0000000000c2',
    'future class',
    '러닝',
    now() + interval '2 days',
    60,
    8,
    0,
    'published'
  );

insert into public.gym_owners (gym_id, user_id) values
  ('10000000-0000-4000-8000-0000000000c1', 'a0a0a0a0-a0a0-40a0-80a0-a0a0a0a0a0a0'),
  ('10000000-0000-4000-8000-0000000000c2', 'c0c0c0c0-c0c0-40c0-80c0-c0c0c0c0c0c0');

insert into public.class_participants (class_id, user_id) values
  ('30000000-0000-4000-8000-0000000000c1', 'a0a0a0a0-a0a0-40a0-80a0-a0a0a0a0a0a0'),
  ('30000000-0000-4000-8000-0000000000c1', 'b0b0b0b0-b0b0-40b0-80b0-b0b0b0b0b0b0'),
  ('30000000-0000-4000-8000-0000000000c1', 'd0d0d0d0-d0d0-40d0-80d0-d0d0d0d0d0d0');

begin;
select set_config('sweating.recording_attendance', 'on', true);
update public.class_participants
set attendance_status = 'attended'
where class_id = '30000000-0000-4000-8000-0000000000c1';
commit;

insert into public.likes (class_id, from_user_id, to_user_id) values
  (
    '30000000-0000-4000-8000-0000000000c1',
    'a0a0a0a0-a0a0-40a0-80a0-a0a0a0a0a0a0',
    'b0b0b0b0-b0b0-40b0-80b0-b0b0b0b0b0b0'
  ),
  (
    '30000000-0000-4000-8000-0000000000c1',
    'b0b0b0b0-b0b0-40b0-80b0-b0b0b0b0b0b0',
    'd0d0d0d0-d0d0-40d0-80d0-d0d0d0d0d0d0'
  );

insert into public.matches (class_id, user_a_id, user_b_id) values
  (
    '30000000-0000-4000-8000-0000000000c1',
    'a0a0a0a0-a0a0-40a0-80a0-a0a0a0a0a0a0',
    'b0b0b0b0-b0b0-40b0-80b0-b0b0b0b0b0b0'
  ),
  (
    '30000000-0000-4000-8000-0000000000c1',
    'b0b0b0b0-b0b0-40b0-80b0-b0b0b0b0b0b0',
    'd0d0d0d0-d0d0-40d0-80d0-d0d0d0d0d0d0'
  );

create or replace function storage.protect_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(current_setting('storage.allow_delete_query', true), '') is distinct from 'true' then
    raise exception 'Direct deletion from storage tables is not allowed. Use the Storage API instead.'
      using errcode = '42501';
  end if;
  return old;
end;
$$;

drop trigger if exists protect_delete on storage.objects;
create trigger protect_delete
before delete on storage.objects
for each row
execute function storage.protect_delete();

begin;
select set_config('storage.allow_delete_query', 'true', true);
delete from storage.objects
where id in (
  'f0f0f0f0-f0f0-40f0-80f0-f0f0f0f0f0f1',
  'f0f0f0f0-f0f0-40f0-80f0-f0f0f0f0f0f2'
);
commit;

insert into storage.objects (id, bucket_id, name, owner) values
  ('f0f0f0f0-f0f0-40f0-80f0-f0f0f0f0f0f1', 'profile-photos', 'a0a0a0a0-a0a0-40a0-80a0-a0a0a0a0a0a0/avatar.jpg', 'a0a0a0a0-a0a0-40a0-80a0-a0a0a0a0a0a0'),
  ('f0f0f0f0-f0f0-40f0-80f0-f0f0f0f0f0f2', 'profile-photos', 'b0b0b0b0-b0b0-40b0-80b0-b0b0b0b0b0b0/avatar.png', 'b0b0b0b0-b0b0-40b0-80b0-b0b0b0b0b0b0');

\echo 'PASS deletion: the log has no PII columns and SQL cannot delete storage objects'

do $$
begin
  delete from storage.objects
  where id = 'f0f0f0f0-f0f0-40f0-80f0-f0f0f0f0f0f1';
  raise exception 'protect_delete allowed a sql delete';
exception
  when insufficient_privilege then
    if sqlerrm not like '%Storage API%' then
      raise;
    end if;
end $$;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'account_deletion_log'
      and column_name in ('user_id', 'email', 'display_name', 'phone', 'name')
  ) then
    raise exception 'account_deletion_log has an identifying column';
  end if;
end $$;

do $$
declare
  definer boolean;
  config text;
  acl text;
begin
  if to_regprocedure('public.delete_own_storage_objects(uuid)') is not null then
    raise exception 'sql storage delete hook is still present';
  end if;
  if to_regprocedure('private.profile_photo_owner_id(text)') is null
     or to_regprocedure('private.can_read_profile_photo(uuid)') is null
     or to_regprocedure('private.is_approved_gym_owner()') is null then
    raise exception 'consent migration removed a private function';
  end if;

  select p.prosecdef, coalesce(p.proconfig::text, ''), coalesce(p.proacl::text, '')
    into definer, config, acl
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'delete_own_account';
  if definer is not true or config not like '%search_path=%' or config like '%public%' then
    raise exception 'delete_own_account security config definer=% config=%', definer, config;
  end if;
  if acl = '' or acl ~ '(^|[{,])=X/' or has_function_privilege('anon', 'public.delete_own_account()', 'execute') then
    raise exception 'anon or public can execute delete_own_account acl=%', acl;
  end if;

  select p.prosecdef into definer
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'enforce_profile_consents';
  if definer then
    raise exception 'profile consent trigger is security definer';
  end if;
end $$;

\echo 'PASS deletion: a gym owner with an upcoming class is refused'

do $$
begin
  perform set_config('request.jwt.claim.sub', 'c0c0c0c0-c0c0-40c0-80c0-c0c0c0c0c0c0', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  perform public.delete_own_account();
  raise exception 'upcoming gym owner was deleted';
exception
  when others then
    if sqlerrm like '%upcoming gym owner was deleted%' then
      raise;
    end if;
    if sqlerrm not like '%gym_owner_upcoming_classes%' then
      raise;
    end if;
end $$;

do $$
declare
  still_there boolean;
  class_still boolean;
begin
  select exists (
    select 1 from auth.users where id = 'c0c0c0c0-c0c0-40c0-80c0-c0c0c0c0c0c0'
  ) into still_there;
  select exists (
    select 1 from public.classes where id = '30000000-0000-4000-8000-0000000000c2'
  ) into class_still;
  if not still_there or not class_still then
    raise exception 'blocked deletion removed the owner or the class';
  end if;
end $$;

\echo 'PASS deletion: the caller is removed and the other member remains'

do $$
begin
  if pg_get_function_identity_arguments('public.delete_own_account()'::regprocedure) <> '' then
    raise exception 'delete_own_account accepts a user id';
  end if;
end $$;

create temp table if not exists deletion_log_snapshot (n integer);
truncate deletion_log_snapshot;
insert into deletion_log_snapshot
select count(*) from public.account_deletion_log;

do $$
begin
  perform set_config('request.jwt.claim.sub', 'a0a0a0a0-a0a0-40a0-80a0-a0a0a0a0a0a0', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  perform public.delete_own_account();
end $$;

do $$
declare
  before_log integer;
  after_log integer;
begin
  select n into before_log from deletion_log_snapshot;
  select count(*) into after_log from public.account_deletion_log;
  if after_log <> before_log + 1 then
    raise exception 'deletion log count % -> %', before_log, after_log;
  end if;
end $$;

do $$
declare
  self_user boolean;
  other_user boolean;
  self_profile integer;
  other_profile integer;
  self_participant integer;
  other_participant integer;
  third_participant integer;
  self_like integer;
  other_like integer;
  self_match integer;
  other_match integer;
  self_owner integer;
  other_consent integer;
  self_consent integer;
  self_object integer;
  other_object integer;
  gym_still boolean;
  past_class boolean;
begin
  select exists (select 1 from auth.users where id = 'a0a0a0a0-a0a0-40a0-80a0-a0a0a0a0a0a0') into self_user;
  select exists (select 1 from auth.users where id = 'b0b0b0b0-b0b0-40b0-80b0-b0b0b0b0b0b0') into other_user;
  select count(*) into self_profile from public.profiles where id = 'a0a0a0a0-a0a0-40a0-80a0-a0a0a0a0a0a0';
  select count(*) into other_profile from public.profiles where id = 'b0b0b0b0-b0b0-40b0-80b0-b0b0b0b0b0b0';
  select count(*) into self_participant from public.class_participants where user_id = 'a0a0a0a0-a0a0-40a0-80a0-a0a0a0a0a0a0';
  select count(*) into other_participant from public.class_participants where user_id = 'b0b0b0b0-b0b0-40b0-80b0-b0b0b0b0b0b0';
  select count(*) into third_participant from public.class_participants where user_id = 'd0d0d0d0-d0d0-40d0-80d0-d0d0d0d0d0d0';
  select count(*) into self_like from public.likes
    where from_user_id = 'a0a0a0a0-a0a0-40a0-80a0-a0a0a0a0a0a0'
       or to_user_id = 'a0a0a0a0-a0a0-40a0-80a0-a0a0a0a0a0a0';
  select count(*) into other_like from public.likes
    where from_user_id = 'b0b0b0b0-b0b0-40b0-80b0-b0b0b0b0b0b0'
      and to_user_id = 'd0d0d0d0-d0d0-40d0-80d0-d0d0d0d0d0d0';
  select count(*) into self_match from public.matches
    where user_a_id = 'a0a0a0a0-a0a0-40a0-80a0-a0a0a0a0a0a0'
       or user_b_id = 'a0a0a0a0-a0a0-40a0-80a0-a0a0a0a0a0a0';
  select count(*) into other_match from public.matches
    where user_a_id = 'b0b0b0b0-b0b0-40b0-80b0-b0b0b0b0b0b0'
      and user_b_id = 'd0d0d0d0-d0d0-40d0-80d0-d0d0d0d0d0d0';
  select count(*) into self_owner from public.gym_owners where user_id = 'a0a0a0a0-a0a0-40a0-80a0-a0a0a0a0a0a0';
  select count(*) into self_consent from public.user_consents where user_id = 'a0a0a0a0-a0a0-40a0-80a0-a0a0a0a0a0a0';
  select count(*) into other_consent from public.user_consents where user_id = 'b0b0b0b0-b0b0-40b0-80b0-b0b0b0b0b0b0';
  select count(*) into self_object from storage.objects where owner = 'a0a0a0a0-a0a0-40a0-80a0-a0a0a0a0a0a0';
  select count(*) into other_object from storage.objects where owner = 'b0b0b0b0-b0b0-40b0-80b0-b0b0b0b0b0b0';
  select exists (select 1 from public.gyms where id = '10000000-0000-4000-8000-0000000000c1') into gym_still;
  select exists (select 1 from public.classes where id = '30000000-0000-4000-8000-0000000000c1') into past_class;

  if self_user
     or self_profile <> 0
     or self_participant <> 0
     or self_like <> 0
     or self_match <> 0
     or self_owner <> 0
     or self_consent <> 0 then
    raise exception 'self data survived user=% profile=% participant=% like=% match=% owner=% consent=%',
      self_user, self_profile, self_participant, self_like, self_match, self_owner, self_consent;
  end if;
  if self_object <> 1 or other_object <> 1 then
    raise exception 'sql account deletion changed storage objects self=% other=%', self_object, other_object;
  end if;
  if not other_user
     or other_profile <> 1
     or other_participant <> 1
     or third_participant <> 1
     or other_like <> 1
     or other_match <> 1
     or other_consent <> 3
     or not gym_still
     or not past_class then
    raise exception 'other data changed user=% profile=% participant=% third=% like=% match=% consent=% object=% gym=% class=%',
      other_user, other_profile, other_participant, third_participant, other_like, other_match, other_consent, other_object, gym_still, past_class;
  end if;
end $$;

drop trigger if exists protect_delete on storage.objects;
drop function if exists storage.protect_delete();

\echo 'CONSENT_AND_DELETION_OK'
