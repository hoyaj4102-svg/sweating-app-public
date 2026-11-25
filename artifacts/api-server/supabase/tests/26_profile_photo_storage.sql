-- TEST ONLY. Profile photo bucket policies.
-- Proves owner write, revealed-peer read, and denial for a non-revealed peer
-- and an anonymous role. Age preference and the 20-45 band do not hide a
-- photo from someone who attended the completed class. Admin can read and
-- cannot delete another member's object.
-- Do not run against a hosted project.

\set ON_ERROR_STOP on

\echo 'PASS: profile photo bucket is private and limited'

do $$
declare
  is_public boolean;
  limit_bytes bigint;
  mimes text[];
  policy_count integer;
begin
  select public, file_size_limit, allowed_mime_types
    into is_public, limit_bytes, mimes
  from storage.buckets
  where id = 'profile-photos';

  if is_public is distinct from false then
    raise exception 'profile photo bucket is public';
  end if;
  if limit_bytes is distinct from 5242880 then
    raise exception 'profile photo size limit is %', limit_bytes;
  end if;
  if mimes is distinct from array['image/jpeg', 'image/png', 'image/webp']::text[] then
    raise exception 'profile photo mime types drifted';
  end if;

  select count(*) into policy_count
  from pg_policies
  where schemaname = 'storage'
    and tablename = 'objects'
    and policyname like 'profile_photos_%';
  if policy_count <> 4 then
    raise exception 'expected 4 profile photo policies, saw %', policy_count;
  end if;

  if exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname like 'profile_photos_%'
      and 'anon' = any (roles)
  ) then
    raise exception 'anonymous role has a profile photo policy';
  end if;
end $$;

\echo 'PASS: profile photo migration does not rewrite profile rows'

do $$
declare
  legacy_urls integer;
begin
  insert into auth.users (id) values
    ('e1200000-0000-4000-8000-000000000001'),
    ('e1200000-0000-4000-8000-000000000002'),
    ('e1200000-0000-4000-8000-000000000003'),
    ('e1200000-0000-4000-8000-000000000004'),
    ('e1200000-0000-4000-8000-000000000005'),
    ('e1200000-0000-4000-8000-000000000006'),
    ('e1200000-0000-4000-8000-000000000007'),
    ('e1200000-0000-4000-8000-000000000008'),
    ('e1200000-0000-4000-8000-000000000009')
  on conflict (id) do nothing;

  insert into public.profiles (id, display_name, birth_year, age_preference, profile_photo_url, is_admin)
  values
    ('e1200000-0000-4000-8000-000000000001', 'Owner', null, 'both', 'https://example.test/legacy-owner.png', false);

  select count(*) into legacy_urls
  from public.profiles
  where id = 'e1200000-0000-4000-8000-000000000001'
    and profile_photo_url = 'https://example.test/legacy-owner.png';
  if legacy_urls <> 1 then
    raise exception 'legacy profile photo URL was rewritten';
  end if;
end $$;

\echo 'PASS setup: profile photo classes'

insert into public.gyms (id, name, address, city)
values ('e1200000-0000-4000-8000-000000000010', 'Photo Gym', 'Busan', 'Busan')
on conflict (id) do nothing;

insert into public.classes (
  id, gym_id, title, sport_type, scheduled_at, duration_minutes, capacity, price, status
) values
  (
    'e1200000-0000-4000-8000-000000000011',
    'e1200000-0000-4000-8000-000000000010',
    'finished class',
    '러닝',
    now() - interval '3 hours',
    60,
    8,
    0,
    'completed'
  ),
  (
    'e1200000-0000-4000-8000-000000000012',
    'e1200000-0000-4000-8000-000000000010',
    'future class',
    '러닝',
    now() + interval '2 hours',
    60,
    8,
    0,
    'published'
  );

do $$
declare
  seoul_year integer := extract(year from (now() at time zone 'Asia/Seoul'))::integer;
  young_year integer := seoul_year - 25;
  older_year integer := seoul_year - 36;
  out_of_band_year integer := seoul_year - 50;
begin
  update public.profiles
  set birth_year = young_year,
      age_preference = 'both'
  where id = 'e1200000-0000-4000-8000-000000000001';

  insert into public.profiles (id, display_name, birth_year, age_preference, is_admin)
  values
    ('e1200000-0000-4000-8000-000000000002', 'Match', older_year, 'both', false),
    ('e1200000-0000-4000-8000-000000000003', 'Mismatch', older_year, 'same_band', false),
    ('e1200000-0000-4000-8000-000000000004', 'Registered', young_year, 'both', false),
    ('e1200000-0000-4000-8000-000000000005', 'Early', young_year, 'both', false),
    ('e1200000-0000-4000-8000-000000000006', 'Admin', young_year, 'both', true),
    ('e1200000-0000-4000-8000-000000000007', 'Stranger', young_year, 'both', false),
    ('e1200000-0000-4000-8000-000000000008', 'No Year', null, 'both', false),
    ('e1200000-0000-4000-8000-000000000009', 'Forty Six', out_of_band_year, 'same_band', false);
end $$;

begin;
select set_config('sweating.recording_attendance', 'on', true);
insert into public.class_participants (class_id, user_id, attendance_status) values
  ('e1200000-0000-4000-8000-000000000011', 'e1200000-0000-4000-8000-000000000001', 'attended'),
  ('e1200000-0000-4000-8000-000000000011', 'e1200000-0000-4000-8000-000000000002', 'attended'),
  ('e1200000-0000-4000-8000-000000000011', 'e1200000-0000-4000-8000-000000000003', 'attended'),
  ('e1200000-0000-4000-8000-000000000011', 'e1200000-0000-4000-8000-000000000004', 'registered'),
  ('e1200000-0000-4000-8000-000000000011', 'e1200000-0000-4000-8000-000000000008', 'attended'),
  ('e1200000-0000-4000-8000-000000000011', 'e1200000-0000-4000-8000-000000000009', 'attended'),
  ('e1200000-0000-4000-8000-000000000012', 'e1200000-0000-4000-8000-000000000005', 'attended');
commit;

insert into storage.objects (bucket_id, name)
values ('profile-photos', 'e1200000-0000-4000-8000-000000000007/avatar.jpg');

\echo 'PASS: owner can insert and update only their own avatar'

do $$
begin
  perform set_config('request.jwt.claim.sub', 'e1200000-0000-4000-8000-000000000001', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  insert into storage.objects (bucket_id, name)
  values ('profile-photos', 'e1200000-0000-4000-8000-000000000001/avatar.jpg');
  update storage.objects
  set metadata = '{"replaced":true}'::jsonb
  where bucket_id = 'profile-photos'
    and name = 'e1200000-0000-4000-8000-000000000001/avatar.jpg';
end $$;

do $$
declare
  replaced boolean;
begin
  select metadata = '{"replaced":true}'::jsonb into replaced
  from storage.objects
  where bucket_id = 'profile-photos'
    and name = 'e1200000-0000-4000-8000-000000000001/avatar.jpg';
  if replaced is distinct from true then
    raise exception 'owner update did not apply';
  end if;
end $$;

do $$
begin
  perform set_config('request.jwt.claim.sub', 'e1200000-0000-4000-8000-000000000001', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  insert into storage.objects (bucket_id, name)
  values ('profile-photos', 'e1200000-0000-4000-8000-000000000007/avatar.png');
  raise exception 'owner wrote another folder';
exception
  when insufficient_privilege then
    null;
end $$;

do $$
begin
  perform set_config('request.jwt.claim.sub', 'e1200000-0000-4000-8000-000000000001', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  insert into storage.objects (bucket_id, name)
  values ('profile-photos', 'e1200000-0000-4000-8000-000000000001/notes.txt');
  raise exception 'owner wrote a non-avatar name';
exception
  when insufficient_privilege then
    null;
end $$;

\echo 'PASS: owner can read their own photo'

do $$
declare
  seen integer;
begin
  perform set_config('request.jwt.claim.sub', 'e1200000-0000-4000-8000-000000000001', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  select count(*) into seen
  from storage.objects
  where bucket_id = 'profile-photos'
    and name = 'e1200000-0000-4000-8000-000000000001/avatar.jpg';
  if seen <> 1 then
    raise exception 'owner saw % own photos', seen;
  end if;
end $$;

\echo 'PASS: revealed peer can read and cannot write'

do $$
declare
  seen integer;
  stranger integer;
begin
  perform set_config('request.jwt.claim.sub', 'e1200000-0000-4000-8000-000000000002', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  select count(*) into seen
  from storage.objects
  where bucket_id = 'profile-photos'
    and name = 'e1200000-0000-4000-8000-000000000001/avatar.jpg';
  select count(*) into stranger
  from storage.objects
  where bucket_id = 'profile-photos'
    and name = 'e1200000-0000-4000-8000-000000000007/avatar.jpg';
  if seen <> 1 or stranger <> 0 then
    raise exception 'revealed peer saw owner=% stranger=%', seen, stranger;
  end if;

  update storage.objects
  set metadata = '{"peer":true}'::jsonb
  where name = 'e1200000-0000-4000-8000-000000000001/avatar.jpg';
  delete from storage.objects
  where name = 'e1200000-0000-4000-8000-000000000001/avatar.jpg';
end $$;

do $$
declare
  still_there integer;
  metadata_changed boolean;
begin
  select count(*) into still_there
  from storage.objects
  where bucket_id = 'profile-photos'
    and name = 'e1200000-0000-4000-8000-000000000001/avatar.jpg';
  select metadata = '{"peer":true}'::jsonb into metadata_changed
  from storage.objects
  where name = 'e1200000-0000-4000-8000-000000000001/avatar.jpg';
  if still_there <> 1 or metadata_changed then
    raise exception 'revealed peer changed the object still=% changed=%', still_there, metadata_changed;
  end if;
end $$;

\echo 'PASS: attended peers outside the recruiting band can read'

do $$
declare
  actor uuid;
  seen integer;
begin
  foreach actor in array array[
    'e1200000-0000-4000-8000-000000000003',
    'e1200000-0000-4000-8000-000000000008',
    'e1200000-0000-4000-8000-000000000009'
  ]::uuid[]
  loop
    execute 'reset role';
    perform set_config('request.jwt.claim.sub', actor::text, true);
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    execute 'set local role authenticated';
    select count(*) into seen
    from storage.objects
    where bucket_id = 'profile-photos'
      and name = 'e1200000-0000-4000-8000-000000000001/avatar.jpg';
    if seen <> 1 then
      raise exception 'attended out-of-band peer % saw % rows', actor, seen;
    end if;
  end loop;
end $$;

\echo 'PASS: profile photo function keeps its security and drops the age gate'

do $$
declare
  src text;
  sec boolean;
  volatility "char";
  config text;
  photo_owner oid;
  reader_owner oid;
  auth_exec boolean;
  anon_exec boolean;
  public_exec boolean;
begin
  select p.prosrc, p.prosecdef, p.provolatile, p.proconfig::text, p.proowner
    into src, sec, volatility, config, reader_owner
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private'
    and p.proname = 'can_read_profile_photo';

  select p.proowner into photo_owner
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private'
    and p.proname = 'profile_photo_owner_id';

  select
    has_function_privilege('authenticated', 'private.can_read_profile_photo(uuid)', 'EXECUTE'),
    has_function_privilege('anon', 'private.can_read_profile_photo(uuid)', 'EXECUTE'),
    exists (
      select 1
      from pg_catalog.pg_proc granted
      join pg_catalog.pg_namespace granted_ns on granted_ns.oid = granted.pronamespace
      cross join lateral aclexplode(granted.proacl) as acl
      where granted_ns.nspname = 'private'
        and granted.proname = 'can_read_profile_photo'
        and acl.grantee = 0
        and acl.privilege_type = 'EXECUTE'
    )
    into auth_exec, anon_exec, public_exec;

  if src is null
     or position('age_preferences_allow' in src) <> 0
     or position('age_preference' in src) <> 0
     or position('attendance_status' in src) = 0
     or position('class_scheduled_end' in src) = 0
     or position('public.is_admin' in src) = 0 then
    raise exception 'can_read_profile_photo body drifted';
  end if;
  if sec is distinct from true
     or volatility is distinct from 's'
     or config is null
     or position('search_path' in config) = 0
     or reader_owner is distinct from photo_owner then
    raise exception 'can_read_profile_photo security drifted sec=% vol=% config=%', sec, volatility, config;
  end if;
  if pg_get_function_identity_arguments('private.can_read_profile_photo(uuid)'::regprocedure)
       is distinct from 'p_owner_id uuid'
     or pg_get_function_result('private.can_read_profile_photo(uuid)'::regprocedure)
       is distinct from 'boolean' then
    raise exception 'can_read_profile_photo signature drifted';
  end if;
  if auth_exec is distinct from true
     or anon_exec is distinct from false
     or public_exec is distinct from false then
    raise exception 'can_read_profile_photo grants drifted auth=% anon=% public=%', auth_exec, anon_exec, public_exec;
  end if;
end $$;

\echo 'PASS: non-revealed peers cannot read'

do $$
declare
  actor uuid;
  seen integer;
begin
  foreach actor in array array[
    'e1200000-0000-4000-8000-000000000004',
    'e1200000-0000-4000-8000-000000000005'
  ]::uuid[]
  loop
    execute 'reset role';
    perform set_config('request.jwt.claim.sub', actor::text, true);
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    execute 'set local role authenticated';
    select count(*) into seen
    from storage.objects
    where bucket_id = 'profile-photos'
      and name = 'e1200000-0000-4000-8000-000000000001/avatar.jpg';
    if seen <> 0 then
      raise exception 'non-revealed peer % saw % rows', actor, seen;
    end if;
  end loop;
end $$;

\echo 'PASS: anonymous role cannot read or write profile photos'

do $$
declare
  seen integer;
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', 'anon', true);
  execute 'set local role anon';
  select count(*) into seen
  from storage.objects
  where bucket_id = 'profile-photos';
  if seen <> 0 then
    raise exception 'anon saw % profile photos', seen;
  end if;
end $$;

do $$
begin
  perform set_config('request.jwt.claim.role', 'anon', true);
  execute 'set local role anon';
  insert into storage.objects (bucket_id, name)
  values ('profile-photos', 'e1200000-0000-4000-8000-000000000001/avatar.png');
  raise exception 'anon insert succeeded';
exception
  when insufficient_privilege then
    null;
end $$;

\echo 'PASS: admin can read and cannot delete another photo'

do $$
declare
  seen integer;
begin
  perform set_config('request.jwt.claim.sub', 'e1200000-0000-4000-8000-000000000006', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  select count(*) into seen
  from storage.objects
  where bucket_id = 'profile-photos'
    and name = 'e1200000-0000-4000-8000-000000000001/avatar.jpg';
  if seen <> 1 then
    raise exception 'admin saw % photos', seen;
  end if;
  delete from storage.objects
  where name = 'e1200000-0000-4000-8000-000000000001/avatar.jpg';
end $$;

do $$
declare
  still_there integer;
begin
  select count(*) into still_there
  from storage.objects
  where name = 'e1200000-0000-4000-8000-000000000001/avatar.jpg';
  if still_there <> 1 then
    raise exception 'admin delete removed the photo';
  end if;
end $$;

\echo 'PASS: owner can delete their own photo'

do $$
declare
  still_there integer;
begin
  perform set_config('request.jwt.claim.sub', 'e1200000-0000-4000-8000-000000000001', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  delete from storage.objects
  where bucket_id = 'profile-photos'
    and name = 'e1200000-0000-4000-8000-000000000001/avatar.jpg';
  select count(*) into still_there
  from storage.objects
  where name = 'e1200000-0000-4000-8000-000000000001/avatar.jpg';
  if still_there <> 0 then
    raise exception 'owner delete left the photo';
  end if;
end $$;

\echo 'PROFILE_PHOTO_STORAGE_OK'
