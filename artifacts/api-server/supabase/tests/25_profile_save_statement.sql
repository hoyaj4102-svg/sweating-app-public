-- TEST ONLY. After 20261030 and 20261108.
-- PUT /profiles/me inserts a missing row with id = auth.uid() and, when the
-- row exists, updates only the editable columns where id = auth.uid().
-- Neither statement writes is_admin. The update does not write id.
-- An upsert that sets id is rejected. Another user's row is unchanged.
-- Do not run against a hosted project.

\set ON_ERROR_STOP on

insert into auth.users (id, email) values
  ('a5a5a5a5-a5a5-45a5-85a5-a5a5a5a5a5a5', 'profile-save-new@example.com'),
  ('b5b5b5b5-b5b5-45b5-85b5-b5b5b5b5b5b5', 'profile-save-existing@example.com'),
  ('c5c5c5c5-c5c5-45c5-85c5-c5c5c5c5c5c5', 'profile-save-other@example.com'),
  ('d5d5d5d5-d5d5-45d5-85d5-d5d5d5d5d5d5', 'profile-save-unused@example.com');

insert into public.profiles (id, display_name, birth_year, is_admin) values
  ('b5b5b5b5-b5b5-45b5-85b5-b5b5b5b5b5b5', 'Existing Name', 1994, false),
  ('c5c5c5c5-c5c5-45c5-85c5-c5c5c5c5c5c5', 'Other Name', 1994, false);

do $$
begin
  if to_regclass('public.user_consents') is null then
    return;
  end if;
  insert into public.user_consents (user_id, kind, version)
  select member_id, kind, public.current_consent_version()
  from (
    values
      ('a5a5a5a5-a5a5-45a5-85a5-a5a5a5a5a5a5'::uuid),
      ('b5b5b5b5-b5b5-45b5-85b5-b5b5b5b5b5b5'::uuid)
  ) as members(member_id)
  cross join (values ('terms'), ('privacy'), ('overseas_transfer')) as required(kind)
  on conflict (user_id, kind, version) do nothing;
end $$;

\echo 'PASS: profile save grants still deny id and is_admin updates'

do $$
begin
  if has_column_privilege('authenticated', 'public.profiles', 'id', 'update') then
    raise exception 'authenticated can UPDATE profiles.id';
  end if;
  if not has_column_privilege('authenticated', 'public.profiles', 'id', 'insert') then
    raise exception 'authenticated cannot INSERT profiles.id';
  end if;
  if has_column_privilege('authenticated', 'public.profiles', 'is_admin', 'insert')
     or has_column_privilege('authenticated', 'public.profiles', 'is_admin', 'update') then
    raise exception 'authenticated can write profiles.is_admin';
  end if;
  if not has_column_privilege('authenticated', 'public.profiles', 'display_name', 'update')
     or not has_column_privilege('authenticated', 'public.profiles', 'age_preference', 'update')
     or not has_column_privilege('authenticated', 'public.profiles', 'birth_year', 'insert') then
    raise exception 'authenticated is missing an editable profile privilege';
  end if;
end $$;

\echo 'PASS: authenticated profile insert writes own id and leaves is_admin false'

do $$
begin
  perform set_config('request.jwt.claim.sub', 'a5a5a5a5-a5a5-45a5-85a5-a5a5a5a5a5a5', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';

  insert into public.profiles (
    display_name,
    birth_year,
    age_preference,
    gender,
    profile_photo_url,
    sports,
    interests,
    bio,
    id
  ) values (
    'New Member',
    1994,
    'both',
    null,
    'https://example.test/new.jpg',
    array['러닝']::text[],
    array['커피']::text[],
    'first bio',
    'a5a5a5a5-a5a5-45a5-85a5-a5a5a5a5a5a5'
  );
end $$;

do $$
declare
  saved public.profiles;
begin
  select * into saved
  from public.profiles
  where id = 'a5a5a5a5-a5a5-45a5-85a5-a5a5a5a5a5a5';

  if saved.id is distinct from 'a5a5a5a5-a5a5-45a5-85a5-a5a5a5a5a5a5'
     or saved.display_name is distinct from 'New Member'
     or saved.birth_year is distinct from 1994
     or saved.age_preference is distinct from 'both'
     or saved.gender is not null
     or saved.profile_photo_url is distinct from 'https://example.test/new.jpg'
     or saved.sports is distinct from array['러닝']::text[]
     or saved.interests is distinct from array['커피']::text[]
     or saved.bio is distinct from 'first bio'
     or saved.is_admin is distinct from false then
    raise exception 'profile insert did not stick admin=% name=%', saved.is_admin, saved.display_name;
  end if;
end $$;

\echo 'PASS: authenticated profile update changes editable columns only'

do $$
begin
  perform set_config('request.jwt.claim.sub', 'b5b5b5b5-b5b5-45b5-85b5-b5b5b5b5b5b5', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';

  update public.profiles
  set
    display_name = 'Existing Updated',
    birth_year = 1994,
    age_preference = 'same_band',
    gender = 'male',
    profile_photo_url = 'https://example.test/updated.jpg',
    sports = array['복싱']::text[],
    interests = array['영화']::text[],
    bio = 'updated bio'
  where id = 'b5b5b5b5-b5b5-45b5-85b5-b5b5b5b5b5b5';

  if not found then
    raise exception 'own profile update matched no row';
  end if;
end $$;

do $$
declare
  saved public.profiles;
begin
  select * into saved
  from public.profiles
  where id = 'b5b5b5b5-b5b5-45b5-85b5-b5b5b5b5b5b5';

  if saved.id is distinct from 'b5b5b5b5-b5b5-45b5-85b5-b5b5b5b5b5b5'
     or saved.display_name is distinct from 'Existing Updated'
     or saved.birth_year is distinct from 1994
     or saved.age_preference is distinct from 'same_band'
     or saved.gender is distinct from 'male'
     or saved.profile_photo_url is distinct from 'https://example.test/updated.jpg'
     or saved.sports is distinct from array['복싱']::text[]
     or saved.interests is distinct from array['영화']::text[]
     or saved.bio is distinct from 'updated bio'
     or saved.is_admin is distinct from false then
    raise exception 'profile update did not stick admin=% name=%', saved.is_admin, saved.display_name;
  end if;
end $$;

\echo 'PASS: authenticated profile save cannot change id'

do $$
begin
  perform set_config('request.jwt.claim.sub', 'a5a5a5a5-a5a5-45a5-85a5-a5a5a5a5a5a5', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  update public.profiles
    set id = 'd5d5d5d5-d5d5-45d5-85d5-d5d5d5d5d5d5'
    where id = 'a5a5a5a5-a5a5-45a5-85a5-a5a5a5a5a5a5';
  raise exception 'id update succeeded';
exception
  when insufficient_privilege then
    if sqlerrm not like '%permission denied%' then
      raise;
    end if;
end $$;

do $$
begin
  perform set_config('request.jwt.claim.sub', 'a5a5a5a5-a5a5-45a5-85a5-a5a5a5a5a5a5', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  update public.profiles
    set id = 'd5d5d5d5-d5d5-45d5-85d5-d5d5d5d5d5d5'
    where id = 'c5c5c5c5-c5c5-45c5-85c5-c5c5c5c5c5c5';
  raise exception 'other id update succeeded';
exception
  when insufficient_privilege then
    if sqlerrm not like '%permission denied%' then
      raise;
    end if;
end $$;

\echo 'PASS: authenticated profile save cannot change is_admin'

do $$
begin
  perform set_config('request.jwt.claim.sub', 'b5b5b5b5-b5b5-45b5-85b5-b5b5b5b5b5b5', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  update public.profiles
    set is_admin = true
    where id = 'b5b5b5b5-b5b5-45b5-85b5-b5b5b5b5b5b5';
  raise exception 'is_admin update succeeded';
exception
  when insufficient_privilege then
    if sqlerrm not like '%permission denied%' and sqlerrm not like '%is_admin_change_forbidden%' then
      raise;
    end if;
end $$;

\echo 'PASS: authenticated profile save cannot change another user'

-- The catalog baseline fixture records grants and does not replay profile
-- policies. Cross-user DML is rejected where row level security is on.
-- Where it is off, the own-row statements above still leave the other row.
do $$
declare
  rls boolean;
  other_name text;
  other_admin boolean;
begin
  select display_name, is_admin into other_name, other_admin
  from public.profiles
  where id = 'c5c5c5c5-c5c5-45c5-85c5-c5c5c5c5c5c5';
  if other_name is distinct from 'Other Name' or other_admin is distinct from false then
    raise exception 'other profile changed name=% admin=%', other_name, other_admin;
  end if;

  select c.relrowsecurity into rls
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'profiles';

  if not coalesce(rls, false) then
    return;
  end if;

  perform set_config('request.jwt.claim.sub', 'a5a5a5a5-a5a5-45a5-85a5-a5a5a5a5a5a5', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';

  update public.profiles
  set
    display_name = 'Hijacked',
    birth_year = 1994,
    age_preference = 'both',
    gender = 'male',
    profile_photo_url = 'https://example.test/hijack.jpg',
    sports = array['러닝']::text[],
    interests = array['커피']::text[],
    bio = 'hijack'
  where id = 'c5c5c5c5-c5c5-45c5-85c5-c5c5c5c5c5c5';

  if found then
    raise exception 'authenticated updated another profile';
  end if;

  begin
    insert into public.profiles (
      display_name,
      birth_year,
      age_preference,
      gender,
      profile_photo_url,
      sports,
      interests,
      bio,
      id
    ) values (
      'Victim',
      1994,
      'both',
      null,
      'https://example.test/victim.jpg',
      array['러닝']::text[],
      array['커피']::text[],
      'nope',
      'd5d5d5d5-d5d5-45d5-85d5-d5d5d5d5d5d5'
    );
    raise exception 'cross-user insert succeeded';
  exception
    when insufficient_privilege then
      if sqlerrm not like '%row-level security%' then
        raise;
      end if;
  end;

  raise notice 'cross-user profile write blocked by row security';
end $$;

\echo 'PASS: upsert that sets id is still rejected'

do $$
begin
  perform set_config('request.jwt.claim.sub', 'a5a5a5a5-a5a5-45a5-85a5-a5a5a5a5a5a5', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';

  insert into public.profiles (
    display_name,
    birth_year,
    age_preference,
    gender,
    profile_photo_url,
    sports,
    interests,
    bio,
    id
  ) values (
    'Should Not Stick',
    1994,
    'both',
    null,
    'https://example.test/upsert.jpg',
    array['러닝']::text[],
    array['커피']::text[],
    'upsert',
    'a5a5a5a5-a5a5-45a5-85a5-a5a5a5a5a5a5'
  )
  on conflict (id) do update set
    id = excluded.id,
    display_name = excluded.display_name,
    birth_year = excluded.birth_year,
    age_preference = excluded.age_preference,
    gender = excluded.gender,
    profile_photo_url = excluded.profile_photo_url,
    sports = excluded.sports,
    interests = excluded.interests,
    bio = excluded.bio;
  raise exception 'upsert that sets id succeeded';
exception
  when insufficient_privilege then
    if sqlerrm not like '%permission denied%' then
      raise;
    end if;
end $$;

do $$
declare
  new_row public.profiles;
  existing_row public.profiles;
  other_row public.profiles;
  unused_count integer;
begin
  select * into new_row
  from public.profiles
  where id = 'a5a5a5a5-a5a5-45a5-85a5-a5a5a5a5a5a5';
  select * into existing_row
  from public.profiles
  where id = 'b5b5b5b5-b5b5-45b5-85b5-b5b5b5b5b5b5';
  select * into other_row
  from public.profiles
  where id = 'c5c5c5c5-c5c5-45c5-85c5-c5c5c5c5c5c5';
  select count(*) into unused_count
  from public.profiles
  where id = 'd5d5d5d5-d5d5-45d5-85d5-d5d5d5d5d5d5';

  if new_row.display_name is distinct from 'New Member'
     or new_row.is_admin is distinct from false
     or existing_row.display_name is distinct from 'Existing Updated'
     or existing_row.is_admin is distinct from false
     or other_row.display_name is distinct from 'Other Name'
     or other_row.is_admin is distinct from false
     or other_row.id is distinct from 'c5c5c5c5-c5c5-45c5-85c5-c5c5c5c5c5c5'
     or unused_count <> 0 then
    raise exception 'profile save statements left rows changed';
  end if;
end $$;

\echo 'PROFILE_SAVE_OK'
