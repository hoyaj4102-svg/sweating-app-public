-- SWEATING V0 / Sprint 01
-- Run this file once in the connected Supabase project's SQL Editor.

create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 40),
  birth_year integer check (birth_year is null or birth_year between 1900 and 2100),
  gender text,
  profile_photo_url text not null default '',
  sports text[] not null default '{}',
  interests text[] not null default '{}',
  bio text,
  is_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.gyms (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  address text not null,
  city text not null,
  latitude double precision,
  longitude double precision,
  image_url text,
  created_at timestamptz not null default now()
);

create table if not exists public.classes (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id) on delete restrict,
  title text not null,
  sport_type text not null,
  description text,
  scheduled_at timestamptz not null,
  duration_minutes integer not null check (duration_minutes > 0),
  capacity integer not null check (capacity > 0),
  price integer not null default 0 check (price >= 0),
  image_url text,
  status text not null default 'draft' check (status in ('draft', 'published', 'completed', 'cancelled')),
  created_at timestamptz not null default now()
);

create table if not exists public.class_participants (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  payment_status text not null default 'free' check (payment_status in ('free', 'pending', 'paid', 'refunded')),
  attendance_status text not null default 'registered' check (attendance_status in ('registered', 'attended', 'cancelled', 'no_show')),
  joined_at timestamptz not null default now(),
  unique (class_id, user_id)
);

create index if not exists classes_status_scheduled_at_idx
  on public.classes(status, scheduled_at);
create index if not exists class_participants_user_idx
  on public.class_participants(user_id, joined_at desc);
create index if not exists class_participants_class_idx
  on public.class_participants(class_id, joined_at);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.gyms enable row level security;
alter table public.classes enable row level security;
alter table public.class_participants enable row level security;

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and is_admin);
$$;

grant execute on function public.is_admin() to anon;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated, service_role;

drop policy if exists "profiles_read_self" on public.profiles;
create policy "profiles_read_self" on public.profiles
for select to authenticated
using (auth.uid() = id or public.is_admin());

drop policy if exists "profiles_insert_self" on public.profiles;
create policy "profiles_insert_self" on public.profiles
for insert to authenticated
with check (auth.uid() = id);

drop policy if exists "profiles_update_self" on public.profiles;
create policy "profiles_update_self" on public.profiles
for update to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

drop policy if exists "gyms_read_public" on public.gyms;
create policy "gyms_read_public" on public.gyms
for select to anon, authenticated
using (true);

drop policy if exists "classes_read_published" on public.classes;
create policy "classes_read_published" on public.classes
for select to anon, authenticated
using (status = 'published' or public.is_admin());

drop policy if exists "participants_read_self" on public.class_participants;
create policy "participants_read_self" on public.class_participants
for select to authenticated
using (user_id = auth.uid() or public.is_admin());

-- All participant inserts go through the locked function below.
drop policy if exists "participants_insert_self" on public.class_participants;

create or replace function public.join_class(p_class_id uuid, p_user_id uuid)
returns public.class_participants
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_class public.classes;
  created_participant public.class_participants;
  current_count integer;
begin
  select * into selected_class
  from public.classes
  where id = p_class_id
  for update;

  if selected_class.id is null then
    raise exception 'class_not_found';
  end if;
  if selected_class.status <> 'published' then
    raise exception 'class_not_open';
  end if;
  if selected_class.scheduled_at <= now() then
    raise exception 'class_started';
  end if;
  if exists (
    select 1 from public.class_participants
    where class_id = p_class_id and user_id = p_user_id
  ) then
    raise exception 'already_joined';
  end if;

  select count(*) into current_count
  from public.class_participants
  where class_id = p_class_id and attendance_status = 'registered';
  if current_count >= selected_class.capacity then
    raise exception 'class_full';
  end if;

  insert into public.class_participants(class_id, user_id)
  values (p_class_id, p_user_id)
  returning * into created_participant;
  return created_participant;
end;
$$;

revoke all on function public.join_class(uuid, uuid) from public, anon, authenticated;
grant execute on function public.join_class(uuid, uuid) to service_role;

-- 예시 테스트 데이터. 이미지 없이도 카드가 동작하도록 구성한다.
insert into public.gyms (id, name, description, address, city)
values
  ('10000000-0000-4000-8000-000000000001', '예시 트레이닝 스튜디오', '바다를 보며 움직이는 소규모 트레이닝 스튜디오', '예시시 예시대로 100', '예시시'),
  ('10000000-0000-4000-8000-000000000002', '예시 베이스먼트 복싱', '처음 오는 사람도 편하게 참여하는 복싱 클래스', '예시시 중앙로 200', '예시시'),
  ('10000000-0000-4000-8000-000000000003', '예시 로드 짐', '러닝과 스트렝스를 함께하는 커뮤니티 짐', '예시시 공원로 10', '예시시')
on conflict (id) do nothing;

insert into public.classes (id, gym_id, title, sport_type, description, scheduled_at, duration_minutes, capacity, price, status)
values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '선셋 러닝 클럽', '러닝', '샘플 해변을 따라 5km를 달린 뒤 가볍게 스트레칭해요.', '2026-09-08 19:00:00+09', 60, 8, 0, 'published'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', '사우스포 소셜', '복싱', '기초 콤비네이션과 미트 트레이닝. 모든 레벨 환영.', '2026-09-10 20:00:00+09', 75, 10, 12000, 'published'),
  ('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000003', '스트렝스 & 커피', '근력 운동', '45분 전신 운동 후 근처 카페에서 천천히 이야기해요.', '2026-09-12 10:30:00+09', 75, 6, 15000, 'published'),
  ('20000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', '선데이 리커버리', '요가', '호흡과 가동성 중심의 일요일 리셋 클래스.', '2026-09-13 16:00:00+09', 60, 10, 10000, 'published')
on conflict (id) do nothing;