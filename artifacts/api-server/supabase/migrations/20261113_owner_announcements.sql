-- SWEATING / 20261113 owner announcements.
-- Do not apply to a hosted or production database without a separate a separate production review.
-- Preview uses the production database. Do not run this file there.
--
-- Newly approved gym owners acknowledge the current principles text.
-- gym_owners.approved_at stays null on existing rows. Nothing backfills it.
-- The admin owner-assign API sets it only when linking an existing account.
-- A later text change is a new principles row and a new notice_version.
-- The previous row stays, with is_current cleared, and owners must ack again.
-- 1:1 messages are not stored here.
--
-- private.is_approved_gym_owner() answers yes or no for auth.uid() only.
-- private.acknowledge_owner_principles(version) is the only ack write.
-- public.acknowledge_owner_principles(version) is a one-line invoker so the
-- session JWT can call it through the already exposed public schema.
-- Do not add the private schema to the Data API exposed schemas.

alter table public.gym_owners
  add column if not exists approved_at timestamptz;

comment on column public.gym_owners.approved_at is
  'Null until an admin links this account. Existing rows are not backfilled. Updates are rejected.';

create index if not exists gym_owners_approved_user_idx
  on public.gym_owners (user_id)
  where approved_at is not null;

create schema if not exists private;

revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.is_approved_gym_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.gym_owners
    where gym_owners.user_id = auth.uid()
      and gym_owners.approved_at is not null
  );
$$;

revoke all on function private.is_approved_gym_owner() from public, anon, authenticated, service_role;
grant execute on function private.is_approved_gym_owner() to authenticated;

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  title text not null,
  body text not null,
  published_at timestamptz not null default now(),
  author_id uuid,
  notice_version text not null,
  is_current boolean not null default false,
  constraint announcements_kind_check
    check (kind in ('principles', 'owner_notice')),
  constraint announcements_title_check
    check (char_length(btrim(title)) between 1 and 200),
  constraint announcements_body_check
    check (char_length(btrim(body)) between 1 and 8000),
  constraint announcements_version_check
    check (notice_version ~ '^[a-z0-9][a-z0-9-]{0,80}$'),
  constraint announcements_principles_version_check
    check (
      kind <> 'principles'
      or notice_version ~ '^owner-principles-[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    ),
  constraint announcements_notice_version_shape_check
    check (
      kind <> 'owner_notice'
      or notice_version ~ '^owner-notice-[a-z0-9-]{1,80}$'
    ),
  constraint announcements_current_kind_check
    check (is_current = false or kind = 'principles'),
  constraint announcements_notice_version_key unique (notice_version)
);

create unique index if not exists announcements_one_current_principles
  on public.announcements ((1))
  where kind = 'principles' and is_current;

create index if not exists announcements_published_idx
  on public.announcements (published_at desc);

-- Author is an admin profile when a person publishes. The seeded principles
-- row has no author. Acknowledgements are not a foreign key to auth.users:
-- the row is insert-only, so deleting an account must not have to delete it.
create table if not exists public.owner_notice_acknowledgements (
  user_id uuid not null,
  notice_version text not null references public.announcements (notice_version),
  acknowledged_at timestamptz not null default now(),
  primary key (user_id, notice_version)
);

create or replace function public.protect_gym_owner_approval()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.approved_at is distinct from old.approved_at then
    raise exception 'approved_at_locked'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.protect_gym_owner_approval() from public, anon, authenticated, service_role;

drop trigger if exists gym_owners_protect_approved_at on public.gym_owners;
create trigger gym_owners_protect_approved_at
before update of approved_at on public.gym_owners
for each row
execute function public.protect_gym_owner_approval();

create or replace function public.protect_announcements()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' or tg_op = 'TRUNCATE' then
    raise exception 'announcement_immutable'
      using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' then
    if new.body is distinct from old.body
       or new.title is distinct from old.title
       or new.kind is distinct from old.kind
       or new.notice_version is distinct from old.notice_version
       or new.author_id is distinct from old.author_id
       or new.published_at is distinct from old.published_at
    then
      raise exception 'announcement_immutable'
        using errcode = '42501';
    end if;
    if new.is_current is distinct from old.is_current and old.kind <> 'principles' then
      raise exception 'announcement_immutable'
        using errcode = '42501';
    end if;
    if new.kind = 'principles' and new.is_current and old.is_current is distinct from true then
      update public.announcements
        set is_current = false
        where kind = 'principles'
          and is_current
          and notice_version is distinct from new.notice_version;
    end if;
    return new;
  end if;

  if new.author_id is not null and not exists (
    select 1
    from public.profiles
    where profiles.id = new.author_id
      and profiles.is_admin is true
  ) then
    raise exception 'admin_required'
      using errcode = '42501';
  end if;

  if new.kind = 'owner_notice' then
    if new.author_id is null then
      raise exception 'admin_required'
        using errcode = '42501';
    end if;
    new.is_current := false;
  end if;

  if new.kind = 'principles' and new.is_current then
    update public.announcements
      set is_current = false
      where kind = 'principles'
        and is_current
        and notice_version is distinct from new.notice_version;
  end if;

  return new;
end;
$$;

revoke all on function public.protect_announcements() from public, anon, authenticated, service_role;

drop trigger if exists announcements_protect on public.announcements;
create trigger announcements_protect
before insert or update or delete on public.announcements
for each row
execute function public.protect_announcements();

drop trigger if exists announcements_protect_truncate on public.announcements;
create trigger announcements_protect_truncate
before truncate on public.announcements
for each statement
execute function public.protect_announcements();

create or replace function public.protect_owner_notice_ack()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  writer text;
begin
  if tg_op <> 'INSERT' then
    raise exception 'ack_immutable'
      using errcode = '42501';
  end if;

  select roles.rolname
    into writer
  from pg_catalog.pg_proc as functions
  join pg_catalog.pg_namespace as schemas on schemas.oid = functions.pronamespace
  join pg_catalog.pg_roles as roles on roles.oid = functions.proowner
  where schemas.nspname = 'private'
    and functions.proname = 'acknowledge_owner_principles'
    and pg_catalog.pg_get_function_identity_arguments(functions.oid) = 'p_version text';

  if current_setting('sweating.ack_owner_principles', true) = 'on'
     and writer is not null
     and current_user = writer
     and new.user_id is not distinct from auth.uid()
  then
    return new;
  end if;

  raise exception 'ack_function_required'
    using errcode = '42501';
end;
$$;

revoke all on function public.protect_owner_notice_ack() from public, anon, authenticated, service_role;

drop trigger if exists owner_notice_ack_protect on public.owner_notice_acknowledgements;
create trigger owner_notice_ack_protect
before insert or update or delete on public.owner_notice_acknowledgements
for each row
execute function public.protect_owner_notice_ack();

drop trigger if exists owner_notice_ack_protect_truncate on public.owner_notice_acknowledgements;
create trigger owner_notice_ack_protect_truncate
before truncate on public.owner_notice_acknowledgements
for each statement
execute function public.protect_owner_notice_ack();

create or replace function private.acknowledge_owner_principles(p_version text)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  existing timestamptz;
  stored timestamptz;
begin
  if actor is null then
    raise exception 'authentication_required';
  end if;

  if not private.is_approved_gym_owner() then
    raise exception 'approved_owner_required'
      using errcode = '42501';
  end if;

  if p_version is null or btrim(p_version) = '' then
    raise exception 'principles_version_mismatch';
  end if;

  if not exists (
    select 1
    from public.announcements
    where announcements.kind = 'principles'
      and announcements.is_current
      and announcements.notice_version = btrim(p_version)
  ) then
    raise exception 'principles_version_mismatch';
  end if;

  select acknowledgements.acknowledged_at
    into existing
  from public.owner_notice_acknowledgements as acknowledgements
  where acknowledgements.user_id = actor
    and acknowledgements.notice_version = btrim(p_version);

  if existing is not null then
    return existing;
  end if;

  perform set_config('sweating.ack_owner_principles', 'on', true);

  begin
    insert into public.owner_notice_acknowledgements (user_id, notice_version)
    values (actor, btrim(p_version))
    returning acknowledged_at into stored;
  exception
    when unique_violation then
      select acknowledgements.acknowledged_at
        into stored
      from public.owner_notice_acknowledgements as acknowledgements
      where acknowledgements.user_id = actor
        and acknowledgements.notice_version = btrim(p_version);
  end;

  if stored is null then
    raise exception 'acknowledgement_missing';
  end if;

  return stored;
end;
$$;

revoke all on function private.acknowledge_owner_principles(text) from public, anon, authenticated, service_role;
grant execute on function private.acknowledge_owner_principles(text) to authenticated;

create or replace function public.acknowledge_owner_principles(p_version text)
returns timestamptz
language sql
security invoker
set search_path = ''
as $$
  select private.acknowledge_owner_principles(p_version);
$$;

revoke all on function public.acknowledge_owner_principles(text) from public, anon, authenticated, service_role;
grant execute on function public.acknowledge_owner_principles(text) to authenticated;

alter table public.announcements enable row level security;
alter table public.owner_notice_acknowledgements enable row level security;

revoke all on table public.announcements from public, anon, authenticated, service_role;
grant select on table public.announcements to authenticated;
grant select, insert on table public.announcements to service_role;

revoke all on table public.owner_notice_acknowledgements from public, anon, authenticated, service_role;
grant select on table public.owner_notice_acknowledgements to authenticated, service_role;

drop policy if exists "announcements_select_approved_owner" on public.announcements;
create policy "announcements_select_approved_owner"
on public.announcements
for select
to authenticated
using ((select private.is_approved_gym_owner()));

drop policy if exists "acks_select_own" on public.owner_notice_acknowledgements;
create policy "acks_select_own"
on public.owner_notice_acknowledgements
for select
to authenticated
using (
  user_id = (select auth.uid())
  and (select private.is_approved_gym_owner())
);

-- Official principles text, version owner-principles-2026-11-12. A wording change is a
-- new row, not an update of this one.
insert into public.announcements (
  kind,
  title,
  body,
  published_at,
  author_id,
  notice_version,
  is_current
)
select
  'principles',
  $principles_title$SWEATING 제휴 체육관 운영 원칙 — 운동으로 시작하는 자연스러운 만남$principles_title$,
  $principles_body$SWEATING의 운동은 단순한 체력 훈련이 아니라, 함께 움직이며 서로를 자연스럽게 알아가는 과정입니다. 관장님께서는 운동 강도나 기록 경쟁보다 두 사람이 대화하고 협력할 수 있는 분위기를 만들어 주세요. 파트너를 바꿔가며 진행하는 순환식 커플 운동을 통해 여러 참가자와 부담 없이 호흡을 맞추고, 서로 응원하며 가까워질 기회를 만드는 것이 운영의 핵심입니다. 신체 접촉과 참여 강도는 각자의 의사를 존중하며, 호감 표현이나 매칭을 강요하지 않습니다.

SWEATING이 지향하는 것은 좋은 만남의 경험이 체육관의 성장으로 이어지는 선순환입니다. 참가자가 운동과 공간에 만족해 자발적인 체험 후기를 남기고, 좋은 인연으로 이어진 분들이 언젠가 “여기서 만나 결혼합니다. 감사합니다”라는 소식을 전할 수 있는 곳을 만들고자 합니다. 이런 진솔한 경험이 쌓이면 체육관은 운동을 배우는 곳을 넘어 좋은 인연이 시작되는 공간으로 기억되고, 입소문과 재방문, 신규 회원 등록으로 이어질 기반이 됩니다.$principles_body$,
  timestamptz '2026-11-12 18:10:00+09',
  null,
  'owner-principles-2026-11-12',
  true
where not exists (
  select 1
  from public.announcements
  where notice_version = 'owner-principles-2026-11-12'
);
