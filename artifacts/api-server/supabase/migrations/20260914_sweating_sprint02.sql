-- SWEATING / Sprint 02
-- Run this file manually in the connected Supabase project's SQL Editor.
-- Do not run this migration automatically from the application.

create table if not exists public.likes (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  from_user_id uuid not null references auth.users(id) on delete cascade,
  to_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (class_id, from_user_id, to_user_id),
  check (from_user_id <> to_user_id)
);

create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  user_a_id uuid not null references auth.users(id) on delete cascade,
  user_b_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (class_id, user_a_id, user_b_id),
  check (user_a_id < user_b_id)
);

create index if not exists likes_class_from_idx
  on public.likes(class_id, from_user_id);
create index if not exists likes_class_to_idx
  on public.likes(class_id, to_user_id);
create index if not exists matches_user_a_idx
  on public.matches(user_a_id, created_at desc);
create index if not exists matches_user_b_idx
  on public.matches(user_b_id, created_at desc);

alter table public.likes enable row level security;
alter table public.matches enable row level security;

-- The Sprint 01 migration defines this function before revoking default privileges.
-- Keep the anonymous class-list policy reproducible for fresh environments.
grant execute on function public.is_admin() to anon;

revoke all on table public.likes, public.matches from anon, authenticated;
grant select on table public.likes, public.matches to authenticated;

drop policy if exists "likes_read_involved" on public.likes;
create policy "likes_read_involved" on public.likes
for select to authenticated
using (from_user_id = auth.uid() or to_user_id = auth.uid());

drop policy if exists "matches_read_involved" on public.matches;
create policy "matches_read_involved" on public.matches
for select to authenticated
using (user_a_id = auth.uid() or user_b_id = auth.uid());

drop policy if exists "classes_read_published" on public.classes;
create policy "classes_read_published" on public.classes
for select to anon, authenticated
using (
  status = 'published'
  or public.is_admin()
  or (
    status = 'completed'
    and exists (
      select 1
      from public.class_participants
      where class_id = public.classes.id
        and user_id = auth.uid()
        and attendance_status <> 'cancelled'
    )
  )
);

create or replace function public.complete_class(p_class_id uuid)
returns public.classes
language plpgsql
security definer
set search_path = public
as $$
declare
  completed_class public.classes;
begin
  if not public.is_admin() then
    raise exception 'admin_required';
  end if;

  update public.classes
  set status = 'completed'
  where id = p_class_id
    and status <> 'cancelled'
  returning * into completed_class;

  if completed_class.id is null then
    raise exception 'class_not_found';
  end if;

  return completed_class;
end;
$$;

revoke all on function public.complete_class(uuid) from public, anon;
grant execute on function public.complete_class(uuid) to authenticated, service_role;

create or replace function public.like_participant(
  p_class_id uuid,
  p_to_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  lower_user_id uuid;
  upper_user_id uuid;
  created_match public.matches;
begin
  if current_user_id is null then
    raise exception 'authentication_required';
  end if;

  if current_user_id = p_to_user_id then
    raise exception 'self_like_not_allowed';
  end if;

  if not exists (
    select 1
    from public.classes
    where id = p_class_id and status = 'completed'
  ) then
    raise exception 'class_not_completed';
  end if;

  if not exists (
    select 1
    from public.class_participants
    where class_id = p_class_id
      and user_id = current_user_id
      and attendance_status <> 'cancelled'
  ) or not exists (
    select 1
    from public.class_participants
    where class_id = p_class_id
      and user_id = p_to_user_id
      and attendance_status <> 'cancelled'
  ) then
    raise exception 'participants_only';
  end if;

  lower_user_id := least(current_user_id, p_to_user_id);
  upper_user_id := greatest(current_user_id, p_to_user_id);
  perform pg_advisory_xact_lock(
    hashtextextended(p_class_id::text || ':' || lower_user_id::text || ':' || upper_user_id::text, 0)
  );

  insert into public.likes(class_id, from_user_id, to_user_id)
  values (p_class_id, current_user_id, p_to_user_id)
  on conflict (class_id, from_user_id, to_user_id) do nothing;

  if exists (
    select 1
    from public.likes
    where class_id = p_class_id
      and from_user_id = p_to_user_id
      and to_user_id = current_user_id
  ) then
    insert into public.matches(class_id, user_a_id, user_b_id)
    values (p_class_id, lower_user_id, upper_user_id)
    on conflict (class_id, user_a_id, user_b_id) do nothing
    returning * into created_match;

    if created_match.id is null then
      select *
      into created_match
      from public.matches
      where class_id = p_class_id
        and user_a_id = lower_user_id
        and user_b_id = upper_user_id;
    end if;
  end if;

  return jsonb_build_object(
    'liked', true,
    'matched', created_match.id is not null,
    'match_id', created_match.id
  );
end;
$$;

revoke all on function public.like_participant(uuid, uuid) from public, anon;
grant execute on function public.like_participant(uuid, uuid) to authenticated, service_role;-- SWEATING / Sprint 02
-- Run this file manually in the connected Supabase project's SQL Editor.
-- Do not run this migration automatically from the application.

create table if not exists public.likes (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  from_user_id uuid not null references auth.users(id) on delete cascade,
  to_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (class_id, from_user_id, to_user_id),
  check (from_user_id <> to_user_id)
);

create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  user_a_id uuid not null references auth.users(id) on delete cascade,
  user_b_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (class_id, user_a_id, user_b_id),
  check (user_a_id < user_b_id)
);

create index if not exists likes_class_from_idx
  on public.likes(class_id, from_user_id);
create index if not exists likes_class_to_idx
  on public.likes(class_id, to_user_id);
create index if not exists matches_user_a_idx
  on public.matches(user_a_id, created_at desc);
create index if not exists matches_user_b_idx
  on public.matches(user_b_id, created_at desc);

alter table public.likes enable row level security;
alter table public.matches enable row level security;

-- The Sprint 01 migration defines this function before revoking default privileges.
-- Keep the anonymous class-list policy reproducible for fresh environments.
grant execute on function public.is_admin() to anon;

revoke all on table public.likes, public.matches from anon, authenticated;
grant select on table public.likes, public.matches to authenticated;

drop policy if exists "likes_read_involved" on public.likes;
create policy "likes_read_involved" on public.likes
for select to authenticated
using (from_user_id = auth.uid() or to_user_id = auth.uid());

drop policy if exists "matches_read_involved" on public.matches;
create policy "matches_read_involved" on public.matches
for select to authenticated
using (user_a_id = auth.uid() or user_b_id = auth.uid());

drop policy if exists "classes_read_published" on public.classes;
create policy "classes_read_published" on public.classes
for select to anon, authenticated
using (
  status = 'published'
  or public.is_admin()
  or (
    status = 'completed'
    and exists (
      select 1
      from public.class_participants
      where class_id = public.classes.id
        and user_id = auth.uid()
        and attendance_status <> 'cancelled'
    )
  )
);

create or replace function public.complete_class(p_class_id uuid)
returns public.classes
language plpgsql
security definer
set search_path = public
as $$
declare
  completed_class public.classes;
begin
  if not public.is_admin() then
    raise exception 'admin_required';
  end if;

  update public.classes
  set status = 'completed'
  where id = p_class_id
    and status <> 'cancelled'
  returning * into completed_class;

  if completed_class.id is null then
    raise exception 'class_not_found';
  end if;

  return completed_class;
end;
$$;

revoke all on function public.complete_class(uuid) from public, anon;
grant execute on function public.complete_class(uuid) to authenticated, service_role;

create or replace function public.like_participant(
  p_class_id uuid,
  p_to_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  lower_user_id uuid;
  upper_user_id uuid;
  created_match public.matches;
begin
  if current_user_id is null then
    raise exception 'authentication_required';
  end if;

  if current_user_id = p_to_user_id then
    raise exception 'self_like_not_allowed';
  end if;

  if not exists (
    select 1
    from public.classes
    where id = p_class_id and status = 'completed'
  ) then
    raise exception 'class_not_completed';
  end if;

  if not exists (
    select 1
    from public.class_participants
    where class_id = p_class_id
      and user_id = current_user_id
      and attendance_status <> 'cancelled'
  ) or not exists (
    select 1
    from public.class_participants
    where class_id = p_class_id
      and user_id = p_to_user_id
      and attendance_status <> 'cancelled'
  ) then
    raise exception 'participants_only';
  end if;

  lower_user_id := least(current_user_id, p_to_user_id);
  upper_user_id := greatest(current_user_id, p_to_user_id);
  perform pg_advisory_xact_lock(
    hashtextextended(p_class_id::text || ':' || lower_user_id::text || ':' || upper_user_id::text, 0)
  );

  insert into public.likes(class_id, from_user_id, to_user_id)
  values (p_class_id, current_user_id, p_to_user_id)
  on conflict (class_id, from_user_id, to_user_id) do nothing;

  if exists (
    select 1
    from public.likes
    where class_id = p_class_id
      and from_user_id = p_to_user_id
      and to_user_id = current_user_id
  ) then
    insert into public.matches(class_id, user_a_id, user_b_id)
    values (p_class_id, lower_user_id, upper_user_id)
    on conflict (class_id, user_a_id, user_b_id) do nothing
    returning * into created_match;

    if created_match.id is null then
      select *
      into created_match
      from public.matches
      where class_id = p_class_id
        and user_a_id = lower_user_id
        and user_b_id = upper_user_id;
    end if;
  end if;

  return jsonb_build_object(
    'liked', true,
    'matched', created_match.id is not null,
    'match_id', created_match.id
  );
end;
$$;

revoke all on function public.like_participant(uuid, uuid) from public, anon;
grant execute on function public.like_participant(uuid, uuid) to authenticated, service_role;-- SWEATING / Sprint 02
-- Run this file manually in the connected Supabase project's SQL Editor.
-- Do not run this migration automatically from the application.

create table if not exists public.likes (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  from_user_id uuid not null references auth.users(id) on delete cascade,
  to_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (class_id, from_user_id, to_user_id),
  check (from_user_id <> to_user_id)
);

create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  user_a_id uuid not null references auth.users(id) on delete cascade,
  user_b_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (class_id, user_a_id, user_b_id),
  check (user_a_id < user_b_id)
);

create index if not exists likes_class_from_idx
  on public.likes(class_id, from_user_id);
create index if not exists likes_class_to_idx
  on public.likes(class_id, to_user_id);
create index if not exists matches_user_a_idx
  on public.matches(user_a_id, created_at desc);
create index if not exists matches_user_b_idx
  on public.matches(user_b_id, created_at desc);

alter table public.likes enable row level security;
alter table public.matches enable row level security;

-- The Sprint 01 migration defines this function before revoking default privileges.
-- Keep the anonymous class-list policy reproducible for fresh environments.
grant execute on function public.is_admin() to anon;

revoke all on table public.likes, public.matches from anon, authenticated;
grant select on table public.likes, public.matches to authenticated;

drop policy if exists "likes_read_involved" on public.likes;
create policy "likes_read_involved" on public.likes
for select to authenticated
using (from_user_id = auth.uid() or to_user_id = auth.uid());

drop policy if exists "matches_read_involved" on public.matches;
create policy "matches_read_involved" on public.matches
for select to authenticated
using (user_a_id = auth.uid() or user_b_id = auth.uid());

drop policy if exists "classes_read_published" on public.classes;
create policy "classes_read_published" on public.classes
for select to anon, authenticated
using (
  status = 'published'
  or public.is_admin()
  or (
    status = 'completed'
    and exists (
      select 1
      from public.class_participants
      where class_id = public.classes.id
        and user_id = auth.uid()
        and attendance_status <> 'cancelled'
    )
  )
);

create or replace function public.complete_class(p_class_id uuid)
returns public.classes
language plpgsql
security definer
set search_path = public
as $$
declare
  completed_class public.classes;
begin
  if not public.is_admin() then
    raise exception 'admin_required';
  end if;

  update public.classes
  set status = 'completed'
  where id = p_class_id
    and status <> 'cancelled'
  returning * into completed_class;

  if completed_class.id is null then
    raise exception 'class_not_found';
  end if;

  return completed_class;
end;
$$;

revoke all on function public.complete_class(uuid) from public, anon;
grant execute on function public.complete_class(uuid) to authenticated, service_role;

create or replace function public.like_participant(
  p_class_id uuid,
  p_to_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  lower_user_id uuid;
  upper_user_id uuid;
  created_match public.matches;
begin
  if current_user_id is null then
    raise exception 'authentication_required';
  end if;

  if current_user_id = p_to_user_id then
    raise exception 'self_like_not_allowed';
  end if;

  if not exists (
    select 1
    from public.classes
    where id = p_class_id and status = 'completed'
  ) then
    raise exception 'class_not_completed';
  end if;

  if not exists (
    select 1
    from public.class_participants
    where class_id = p_class_id
      and user_id = current_user_id
      and attendance_status <> 'cancelled'
  ) or not exists (
    select 1
    from public.class_participants
    where class_id = p_class_id
      and user_id = p_to_user_id
      and attendance_status <> 'cancelled'
  ) then
    raise exception 'participants_only';
  end if;

  lower_user_id := least(current_user_id, p_to_user_id);
  upper_user_id := greatest(current_user_id, p_to_user_id);
  perform pg_advisory_xact_lock(
    hashtextextended(p_class_id::text || ':' || lower_user_id::text || ':' || upper_user_id::text, 0)
  );

  insert into public.likes(class_id, from_user_id, to_user_id)
  values (p_class_id, current_user_id, p_to_user_id)
  on conflict (class_id, from_user_id, to_user_id) do nothing;

  if exists (
    select 1
    from public.likes
    where class_id = p_class_id
      and from_user_id = p_to_user_id
      and to_user_id = current_user_id
  ) then
    insert into public.matches(class_id, user_a_id, user_b_id)
    values (p_class_id, lower_user_id, upper_user_id)
    on conflict (class_id, user_a_id, user_b_id) do nothing
    returning * into created_match;

    if created_match.id is null then
      select *
      into created_match
      from public.matches
      where class_id = p_class_id
        and user_a_id = lower_user_id
        and user_b_id = upper_user_id;
    end if;
  end if;

  return jsonb_build_object(
    'liked', true,
    'matched', created_match.id is not null,
    'match_id', created_match.id
  );
end;
$$;

revoke all on function public.like_participant(uuid, uuid) from public, anon;
grant execute on function public.like_participant(uuid, uuid) to authenticated, service_role;-- SWEATING / Sprint 02
-- Run this file manually in the connected Supabase project's SQL Editor.
-- Do not run this migration automatically from the application.

create table if not exists public.likes (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  from_user_id uuid not null references auth.users(id) on delete cascade,
  to_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (class_id, from_user_id, to_user_id),
  check (from_user_id <> to_user_id)
);

create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  user_a_id uuid not null references auth.users(id) on delete cascade,
  user_b_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (class_id, user_a_id, user_b_id),
  check (user_a_id < user_b_id)
);

create index if not exists likes_class_from_idx
  on public.likes(class_id, from_user_id);
create index if not exists likes_class_to_idx
  on public.likes(class_id, to_user_id);
create index if not exists matches_user_a_idx
  on public.matches(user_a_id, created_at desc);
create index if not exists matches_user_b_idx
  on public.matches(user_b_id, created_at desc);

alter table public.likes enable row level security;
alter table public.matches enable row level security;

-- The Sprint 01 migration defines this function before revoking default privileges.
-- Keep the anonymous class-list policy reproducible for fresh environments.
grant execute on function public.is_admin() to anon;

revoke all on table public.likes, public.matches from anon, authenticated;
grant select on table public.likes, public.matches to authenticated;

drop policy if exists "likes_read_involved" on public.likes;
create policy "likes_read_involved" on public.likes
for select to authenticated
using (from_user_id = auth.uid() or to_user_id = auth.uid());

drop policy if exists "matches_read_involved" on public.matches;
create policy "matches_read_involved" on public.matches
for select to authenticated
using (user_a_id = auth.uid() or user_b_id = auth.uid());

drop policy if exists "classes_read_published" on public.classes;
create policy "classes_read_published" on public.classes
for select to anon, authenticated
using (
  status = 'published'
  or public.is_admin()
  or (
    status = 'completed'
    and exists (
      select 1
      from public.class_participants
      where class_id = public.classes.id
        and user_id = auth.uid()
        and attendance_status <> 'cancelled'
    )
  )
);

create or replace function public.complete_class(p_class_id uuid)
returns public.classes
language plpgsql
security definer
set search_path = public
as $$
declare
  completed_class public.classes;
begin
  if not public.is_admin() then
    raise exception 'admin_required';
  end if;

  update public.classes
  set status = 'completed'
  where id = p_class_id
    and status <> 'cancelled'
  returning * into completed_class;

  if completed_class.id is null then
    raise exception 'class_not_found';
  end if;

  return completed_class;
end;
$$;

revoke all on function public.complete_class(uuid) from public, anon;
grant execute on function public.complete_class(uuid) to authenticated, service_role;

create or replace function public.like_participant(
  p_class_id uuid,
  p_to_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  lower_user_id uuid;
  upper_user_id uuid;
  created_match public.matches;
begin
  if current_user_id is null then
    raise exception 'authentication_required';
  end if;

  if current_user_id = p_to_user_id then
    raise exception 'self_like_not_allowed';
  end if;

  if not exists (
    select 1
    from public.classes
    where id = p_class_id and status = 'completed'
  ) then
    raise exception 'class_not_completed';
  end if;

  if not exists (
    select 1
    from public.class_participants
    where class_id = p_class_id
      and user_id = current_user_id
      and attendance_status <> 'cancelled'
  ) or not exists (
    select 1
    from public.class_participants
    where class_id = p_class_id
      and user_id = p_to_user_id
      and attendance_status <> 'cancelled'
  ) then
    raise exception 'participants_only';
  end if;

  lower_user_id := least(current_user_id, p_to_user_id);
  upper_user_id := greatest(current_user_id, p_to_user_id);
  perform pg_advisory_xact_lock(
    hashtextextended(p_class_id::text || ':' || lower_user_id::text || ':' || upper_user_id::text, 0)
  );

  insert into public.likes(class_id, from_user_id, to_user_id)
  values (p_class_id, current_user_id, p_to_user_id)
  on conflict (class_id, from_user_id, to_user_id) do nothing;

  if exists (
    select 1
    from public.likes
    where class_id = p_class_id
      and from_user_id = p_to_user_id
      and to_user_id = current_user_id
  ) then
    insert into public.matches(class_id, user_a_id, user_b_id)
    values (p_class_id, lower_user_id, upper_user_id)
    on conflict (class_id, user_a_id, user_b_id) do nothing
    returning * into created_match;

    if created_match.id is null then
      select *
      into created_match
      from public.matches
      where class_id = p_class_id
        and user_a_id = lower_user_id
        and user_b_id = upper_user_id;
    end if;
  end if;

  return jsonb_build_object(
    'liked', true,
    'matched', created_match.id is not null,
    'match_id', created_match.id
  );
end;
$$;

revoke all on function public.like_participant(uuid, uuid) from public, anon;
grant execute on function public.like_participant(uuid, uuid) to authenticated, service_role;-- SWEATING / Sprint 02
-- Run this file manually in the connected Supabase project's SQL Editor.
-- Do not run this migration automatically from the application.

create table if not exists public.likes (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  from_user_id uuid not null references auth.users(id) on delete cascade,
  to_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (class_id, from_user_id, to_user_id),
  check (from_user_id <> to_user_id)
);

create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  user_a_id uuid not null references auth.users(id) on delete cascade,
  user_b_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (class_id, user_a_id, user_b_id),
  check (user_a_id < user_b_id)
);

create index if not exists likes_class_from_idx
  on public.likes(class_id, from_user_id);
create index if not exists likes_class_to_idx
  on public.likes(class_id, to_user_id);
create index if not exists matches_user_a_idx
  on public.matches(user_a_id, created_at desc);
create index if not exists matches_user_b_idx
  on public.matches(user_b_id, created_at desc);

alter table public.likes enable row level security;
alter table public.matches enable row level security;

-- The Sprint 01 migration defines this function before revoking default privileges.
-- Keep the anonymous class-list policy reproducible for fresh environments.
grant execute on function public.is_admin() to anon;

revoke all on table public.likes, public.matches from anon, authenticated;
grant select on table public.likes, public.matches to authenticated;

drop policy if exists "likes_read_involved" on public.likes;
create policy "likes_read_involved" on public.likes
for select to authenticated
using (from_user_id = auth.uid() or to_user_id = auth.uid());

drop policy if exists "matches_read_involved" on public.matches;
create policy "matches_read_involved" on public.matches
for select to authenticated
using (user_a_id = auth.uid() or user_b_id = auth.uid());

drop policy if exists "classes_read_published" on public.classes;
create policy "classes_read_published" on public.classes
for select to anon, authenticated
using (
  status = 'published'
  or public.is_admin()
  or (
    status = 'completed'
    and exists (
      select 1
      from public.class_participants
      where class_id = public.classes.id
        and user_id = auth.uid()
        and attendance_status <> 'cancelled'
    )
  )
);

create or replace function public.complete_class(p_class_id uuid)
returns public.classes
language plpgsql
security definer
set search_path = public
as $$
declare
  completed_class public.classes;
begin
  if not public.is_admin() then
    raise exception 'admin_required';
  end if;

  update public.classes
  set status = 'completed'
  where id = p_class_id
    and status <> 'cancelled'
  returning * into completed_class;

  if completed_class.id is null then
    raise exception 'class_not_found';
  end if;

  return completed_class;
end;
$$;

revoke all on function public.complete_class(uuid) from public, anon;
grant execute on function public.complete_class(uuid) to authenticated, service_role;

create or replace function public.like_participant(
  p_class_id uuid,
  p_to_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  lower_user_id uuid;
  upper_user_id uuid;
  created_match public.matches;
begin
  if current_user_id is null then
    raise exception 'authentication_required';
  end if;

  if current_user_id = p_to_user_id then
    raise exception 'self_like_not_allowed';
  end if;

  if not exists (
    select 1
    from public.classes
    where id = p_class_id and status = 'completed'
  ) then
    raise exception 'class_not_completed';
  end if;

  if not exists (
    select 1
    from public.class_participants
    where class_id = p_class_id
      and user_id = current_user_id
      and attendance_status <> 'cancelled'
  ) or not exists (
    select 1
    from public.class_participants
    where class_id = p_class_id
      and user_id = p_to_user_id
      and attendance_status <> 'cancelled'
  ) then
    raise exception 'participants_only';
  end if;

  lower_user_id := least(current_user_id, p_to_user_id);
  upper_user_id := greatest(current_user_id, p_to_user_id);
  perform pg_advisory_xact_lock(
    hashtextextended(p_class_id::text || ':' || lower_user_id::text || ':' || upper_user_id::text, 0)
  );

  insert into public.likes(class_id, from_user_id, to_user_id)
  values (p_class_id, current_user_id, p_to_user_id)
  on conflict (class_id, from_user_id, to_user_id) do nothing;

  if exists (
    select 1
    from public.likes
    where class_id = p_class_id
      and from_user_id = p_to_user_id
      and to_user_id = current_user_id
  ) then
    insert into public.matches(class_id, user_a_id, user_b_id)
    values (p_class_id, lower_user_id, upper_user_id)
    on conflict (class_id, user_a_id, user_b_id) do nothing
    returning * into created_match;

    if created_match.id is null then
      select *
      into created_match
      from public.matches
      where class_id = p_class_id
        and user_a_id = lower_user_id
        and user_b_id = upper_user_id;
    end if;
  end if;

  return jsonb_build_object(
    'liked', true,
    'matched', created_match.id is not null,
    'match_id', created_match.id
  );
end;
$$;

revoke all on function public.like_participant(uuid, uuid) from public, anon;
grant execute on function public.like_participant(uuid, uuid) to authenticated, service_role;-- SWEATING / Sprint 02
-- Run this file manually in the connected Supabase project's SQL Editor.
-- Do not run this migration automatically from the application.

create table if not exists public.likes (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  from_user_id uuid not null references auth.users(id) on delete cascade,
  to_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (class_id, from_user_id, to_user_id),
  check (from_user_id <> to_user_id)
);

create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  user_a_id uuid not null references auth.users(id) on delete cascade,
  user_b_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (class_id, user_a_id, user_b_id),
  check (user_a_id < user_b_id)
);

create index if not exists likes_class_from_idx
  on public.likes(class_id, from_user_id);
create index if not exists likes_class_to_idx
  on public.likes(class_id, to_user_id);
create index if not exists matches_user_a_idx
  on public.matches(user_a_id, created_at desc);
create index if not exists matches_user_b_idx
  on public.matches(user_b_id, created_at desc);

alter table public.likes enable row level security;
alter table public.matches enable row level security;

-- The Sprint 01 migration defines this function before revoking default privileges.
-- Keep the anonymous class-list policy reproducible for fresh environments.
grant execute on function public.is_admin() to anon;

revoke all on table public.likes, public.matches from anon, authenticated;
grant select on table public.likes, public.matches to authenticated;

drop policy if exists "likes_read_involved" on public.likes;
create policy "likes_read_involved" on public.likes
for select to authenticated
using (from_user_id = auth.uid() or to_user_id = auth.uid());

drop policy if exists "matches_read_involved" on public.matches;
create policy "matches_read_involved" on public.matches
for select to authenticated
using (user_a_id = auth.uid() or user_b_id = auth.uid());

drop policy if exists "classes_read_published" on public.classes;
create policy "classes_read_published" on public.classes
for select to anon, authenticated
using (
  status = 'published'
  or public.is_admin()
  or (
    status = 'completed'
    and exists (
      select 1
      from public.class_participants
      where class_id = public.classes.id
        and user_id = auth.uid()
        and attendance_status <> 'cancelled'
    )
  )
);

create or replace function public.complete_class(p_class_id uuid)
returns public.classes
language plpgsql
security definer
set search_path = public
as $$
declare
  completed_class public.classes;
begin
  if not public.is_admin() then
    raise exception 'admin_required';
  end if;

  update public.classes
  set status = 'completed'
  where id = p_class_id
    and status <> 'cancelled'
  returning * into completed_class;

  if completed_class.id is null then
    raise exception 'class_not_found';
  end if;

  return completed_class;
end;
$$;

revoke all on function public.complete_class(uuid) from public, anon;
grant execute on function public.complete_class(uuid) to authenticated, service_role;

create or replace function public.like_participant(
  p_class_id uuid,
  p_to_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  lower_user_id uuid;
  upper_user_id uuid;
  created_match public.matches;
begin
  if current_user_id is null then
    raise exception 'authentication_required';
  end if;

  if current_user_id = p_to_user_id then
    raise exception 'self_like_not_allowed';
  end if;

  if not exists (
    select 1
    from public.classes
    where id = p_class_id and status = 'completed'
  ) then
    raise exception 'class_not_completed';
  end if;

  if not exists (
    select 1
    from public.class_participants
    where class_id = p_class_id
      and user_id = current_user_id
      and attendance_status <> 'cancelled'
  ) or not exists (
    select 1
    from public.class_participants
    where class_id = p_class_id
      and user_id = p_to_user_id
      and attendance_status <> 'cancelled'
  ) then
    raise exception 'participants_only';
  end if;

  lower_user_id := least(current_user_id, p_to_user_id);
  upper_user_id := greatest(current_user_id, p_to_user_id);
  perform pg_advisory_xact_lock(
    hashtextextended(p_class_id::text || ':' || lower_user_id::text || ':' || upper_user_id::text, 0)
  );

  insert into public.likes(class_id, from_user_id, to_user_id)
  values (p_class_id, current_user_id, p_to_user_id)
  on conflict (class_id, from_user_id, to_user_id) do nothing;

  if exists (
    select 1
    from public.likes
    where class_id = p_class_id
      and from_user_id = p_to_user_id
      and to_user_id = current_user_id
  ) then
    insert into public.matches(class_id, user_a_id, user_b_id)
    values (p_class_id, lower_user_id, upper_user_id)
    on conflict (class_id, user_a_id, user_b_id) do nothing
    returning * into created_match;

    if created_match.id is null then
      select *
      into created_match
      from public.matches
      where class_id = p_class_id
        and user_a_id = lower_user_id
        and user_b_id = upper_user_id;
    end if;
  end if;

  return jsonb_build_object(
    'liked', true,
    'matched', created_match.id is not null,
    'match_id', created_match.id
  );
end;
$$;

revoke all on function public.like_participant(uuid, uuid) from public, anon;
grant execute on function public.like_participant(uuid, uuid) to authenticated, service_role;-- SWEATING / Sprint 02
-- Run this file manually in the connected Supabase project's SQL Editor.
-- Do not run this migration automatically from the application.

create table if not exists public.likes (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  from_user_id uuid not null references auth.users(id) on delete cascade,
  to_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (class_id, from_user_id, to_user_id),
  check (from_user_id <> to_user_id)
);

create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  user_a_id uuid not null references auth.users(id) on delete cascade,
  user_b_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (class_id, user_a_id, user_b_id),
  check (user_a_id < user_b_id)
);

create index if not exists likes_class_from_idx
  on public.likes(class_id, from_user_id);
create index if not exists likes_class_to_idx
  on public.likes(class_id, to_user_id);
create index if not exists matches_user_a_idx
  on public.matches(user_a_id, created_at desc);
create index if not exists matches_user_b_idx
  on public.matches(user_b_id, created_at desc);

alter table public.likes enable row level security;
alter table public.matches enable row level security;

-- The Sprint 01 migration defines this function before revoking default privileges.
-- Keep the anonymous class-list policy reproducible for fresh environments.
grant execute on function public.is_admin() to anon;

revoke all on table public.likes, public.matches from anon, authenticated;
grant select on table public.likes, public.matches to authenticated;

drop policy if exists "likes_read_involved" on public.likes;
create policy "likes_read_involved" on public.likes
for select to authenticated
using (from_user_id = auth.uid() or to_user_id = auth.uid());

drop policy if exists "matches_read_involved" on public.matches;
create policy "matches_read_involved" on public.matches
for select to authenticated
using (user_a_id = auth.uid() or user_b_id = auth.uid());

drop policy if exists "classes_read_published" on public.classes;
create policy "classes_read_published" on public.classes
for select to anon, authenticated
using (
  status = 'published'
  or public.is_admin()
  or (
    status = 'completed'
    and exists (
      select 1
      from public.class_participants
      where class_id = public.classes.id
        and user_id = auth.uid()
        and attendance_status <> 'cancelled'
    )
  )
);

create or replace function public.complete_class(p_class_id uuid)
returns public.classes
language plpgsql
security definer
set search_path = public
as $$
declare
  completed_class public.classes;
begin
  if not public.is_admin() then
    raise exception 'admin_required';
  end if;

  update public.classes
  set status = 'completed'
  where id = p_class_id
    and status <> 'cancelled'
  returning * into completed_class;

  if completed_class.id is null then
    raise exception 'class_not_found';
  end if;

  return completed_class;
end;
$$;

revoke all on function public.complete_class(uuid) from public, anon;
grant execute on function public.complete_class(uuid) to authenticated, service_role;

create or replace function public.like_participant(
  p_class_id uuid,
  p_to_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  lower_user_id uuid;
  upper_user_id uuid;
  created_match public.matches;
begin
  if current_user_id is null then
    raise exception 'authentication_required';
  end if;

  if current_user_id = p_to_user_id then
    raise exception 'self_like_not_allowed';
  end if;

  if not exists (
    select 1
    from public.classes
    where id = p_class_id and status = 'completed'
  ) then
    raise exception 'class_not_completed';
  end if;

  if not exists (
    select 1
    from public.class_participants
    where class_id = p_class_id
      and user_id = current_user_id
      and attendance_status <> 'cancelled'
  ) or not exists (
    select 1
    from public.class_participants
    where class_id = p_class_id
      and user_id = p_to_user_id
      and attendance_status <> 'cancelled'
  ) then
    raise exception 'participants_only';
  end if;

  lower_user_id := least(current_user_id, p_to_user_id);
  upper_user_id := greatest(current_user_id, p_to_user_id);
  perform pg_advisory_xact_lock(
    hashtextextended(p_class_id::text || ':' || lower_user_id::text || ':' || upper_user_id::text, 0)
  );

  insert into public.likes(class_id, from_user_id, to_user_id)
  values (p_class_id, current_user_id, p_to_user_id)
  on conflict (class_id, from_user_id, to_user_id) do nothing;

  if exists (
    select 1
    from public.likes
    where class_id = p_class_id
      and from_user_id = p_to_user_id
      and to_user_id = current_user_id
  ) then
    insert into public.matches(class_id, user_a_id, user_b_id)
    values (p_class_id, lower_user_id, upper_user_id)
    on conflict (class_id, user_a_id, user_b_id) do nothing
    returning * into created_match;

    if created_match.id is null then
      select *
      into created_match
      from public.matches
      where class_id = p_class_id
        and user_a_id = lower_user_id
        and user_b_id = upper_user_id;
    end if;
  end if;

  return jsonb_build_object(
    'liked', true,
    'matched', created_match.id is not null,
    'match_id', created_match.id
  );
end;
$$;

revoke all on function public.like_participant(uuid, uuid) from public, anon;
grant execute on function public.like_participant(uuid, uuid) to authenticated, service_role;-- SWEATING / Sprint 02
-- Run this file manually in the connected Supabase project's SQL Editor.
-- Do not run this migration automatically from the application.

create table if not exists public.likes (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  from_user_id uuid not null references auth.users(id) on delete cascade,
  to_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (class_id, from_user_id, to_user_id),
  check (from_user_id <> to_user_id)
);

create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  user_a_id uuid not null references auth.users(id) on delete cascade,
  user_b_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (class_id, user_a_id, user_b_id),
  check (user_a_id < user_b_id)
);

create index if not exists likes_class_from_idx
  on public.likes(class_id, from_user_id);
create index if not exists likes_class_to_idx
  on public.likes(class_id, to_user_id);
create index if not exists matches_user_a_idx
  on public.matches(user_a_id, created_at desc);
create index if not exists matches_user_b_idx
  on public.matches(user_b_id, created_at desc);

alter table public.likes enable row level security;
alter table public.matches enable row level security;

-- The Sprint 01 migration defines this function before revoking default privileges.
-- Keep the anonymous class-list policy reproducible for fresh environments.
grant execute on function public.is_admin() to anon;

revoke all on table public.likes, public.matches from anon, authenticated;
grant select on table public.likes, public.matches to authenticated;

drop policy if exists "likes_read_involved" on public.likes;
create policy "likes_read_involved" on public.likes
for select to authenticated
using (from_user_id = auth.uid() or to_user_id = auth.uid());

drop policy if exists "matches_read_involved" on public.matches;
create policy "matches_read_involved" on public.matches
for select to authenticated
using (user_a_id = auth.uid() or user_b_id = auth.uid());

drop policy if exists "classes_read_published" on public.classes;
create policy "classes_read_published" on public.classes
for select to anon, authenticated
using (
  status = 'published'
  or public.is_admin()
  or (
    status = 'completed'
    and exists (
      select 1
      from public.class_participants
      where class_id = public.classes.id
        and user_id = auth.uid()
        and attendance_status <> 'cancelled'
    )
  )
);

create or replace function public.complete_class(p_class_id uuid)
returns public.classes
language plpgsql
security definer
set search_path = public
as $$
declare
  completed_class public.classes;
begin
  if not public.is_admin() then
    raise exception 'admin_required';
  end if;

  update public.classes
  set status = 'completed'
  where id = p_class_id
    and status <> 'cancelled'
  returning * into completed_class;

  if completed_class.id is null then
    raise exception 'class_not_found';
  end if;

  return completed_class;
end;
$$;

revoke all on function public.complete_class(uuid) from public, anon;
grant execute on function public.complete_class(uuid) to authenticated, service_role;

create or replace function public.like_participant(
  p_class_id uuid,
  p_to_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  lower_user_id uuid;
  upper_user_id uuid;
  created_match public.matches;
begin
  if current_user_id is null then
    raise exception 'authentication_required';
  end if;

  if current_user_id = p_to_user_id then
    raise exception 'self_like_not_allowed';
  end if;

  if not exists (
    select 1
    from public.classes
    where id = p_class_id and status = 'completed'
  ) then
    raise exception 'class_not_completed';
  end if;

  if not exists (
    select 1
    from public.class_participants
    where class_id = p_class_id
      and user_id = current_user_id
      and attendance_status <> 'cancelled'
  ) or not exists (
    select 1
    from public.class_participants
    where class_id = p_class_id
      and user_id = p_to_user_id
      and attendance_status <> 'cancelled'
  ) then
    raise exception 'participants_only';
  end if;

  lower_user_id := least(current_user_id, p_to_user_id);
  upper_user_id := greatest(current_user_id, p_to_user_id);
  perform pg_advisory_xact_lock(
    hashtextextended(p_class_id::text || ':' || lower_user_id::text || ':' || upper_user_id::text, 0)
  );

  insert into public.likes(class_id, from_user_id, to_user_id)
  values (p_class_id, current_user_id, p_to_user_id)
  on conflict (class_id, from_user_id, to_user_id) do nothing;

  if exists (
    select 1
    from public.likes
    where class_id = p_class_id
      and from_user_id = p_to_user_id
      and to_user_id = current_user_id
  ) then
    insert into public.matches(class_id, user_a_id, user_b_id)
    values (p_class_id, lower_user_id, upper_user_id)
    on conflict (class_id, user_a_id, user_b_id) do nothing
    returning * into created_match;

    if created_match.id is null then
      select *
      into created_match
      from public.matches
      where class_id = p_class_id
        and user_a_id = lower_user_id
        and user_b_id = upper_user_id;
    end if;
  end if;

  return jsonb_build_object(
    'liked', true,
    'matched', created_match.id is not null,
    'match_id', created_match.id
  );
end;
$$;

revoke all on function public.like_participant(uuid, uuid) from public, anon;
grant execute on function public.like_participant(uuid, uuid) to authenticated, service_role;