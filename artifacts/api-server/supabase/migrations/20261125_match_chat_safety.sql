-- SWEATING / 20261125 match chat safety: block, report, and send rate limits.
-- Do not apply to a hosted or production database without a separate a separate production review.
-- Preview uses the production database. Do not run this file there.
-- The Vercel build does not run SQL. CI applies it only to throwaway Postgres.
--
-- Builds on 20261124_match_messages.sql:
--   1) Blocks (public.match_chat_blocks): either person in a match can block
--      the conversation. Once blocked, neither side can send new messages.
--      Only the blocker can unblock. No role can write the table directly;
--      writes go through private.block_match_chat / private.unblock_match_chat.
--      SELECT RLS lets authenticated read only their own blocker rows.
--   2) Reports (public.match_chat_reports): either person in a match can
--      report the conversation or one message in it, with a fixed reason
--      category and optional detail up to 500 chars. SELECT RLS limits the
--      table to admins (public.is_admin()) only; never visible to the reported
--      user, third parties, or non-admin reporters. No email or notification.
--   3) Send rate limits (inside private.send_match_message): max 10 messages
--      per minute and max 100 messages per 24 hours per sender per match,
--      serialized with pg_advisory_xact_lock.
--
-- Security style matches 20261113, 20261122, and 20261124:
--   * Definer functions live in private, pin search_path = '', and revoke
--     EXECUTE from public, anon, and service_role (authenticated only).
--   * Public wrappers are thin SECURITY INVOKER functions with search_path = ''.
--   * Likes, matches, and like-blocking are untouched.
-- Idempotent: safe to run twice.

create schema if not exists private;

revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create table if not exists public.match_chat_blocks (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches (id) on delete cascade,
  blocker_id uuid not null references auth.users (id) on delete cascade,
  blocked_user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (match_id, blocker_id),
  constraint match_chat_blocks_distinct_users check (blocker_id <> blocked_user_id)
);

comment on table public.match_chat_blocks is
  'Per-match chat blocks. Only the blocker can see own rows via RLS; writes go through private.block_match_chat and private.unblock_match_chat.';

create index if not exists match_chat_blocks_blocked_user_idx
  on public.match_chat_blocks (blocked_user_id);

alter table public.match_chat_blocks enable row level security;

revoke all on table public.match_chat_blocks from public, anon, authenticated, service_role;
grant select on table public.match_chat_blocks to authenticated;

drop policy if exists "match_chat_blocks_read_own" on public.match_chat_blocks;
create policy "match_chat_blocks_read_own" on public.match_chat_blocks
for select to authenticated
using (blocker_id = (select auth.uid()));

create table if not exists public.match_chat_reports (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches (id) on delete cascade,
  message_id uuid null references public.match_messages (id) on delete set null,
  reporter_id uuid not null references auth.users (id) on delete cascade,
  reported_user_id uuid not null references auth.users (id) on delete cascade,
  reason text not null,
  detail text null,
  created_at timestamptz not null default now(),
  constraint match_chat_reports_distinct_users
    check (reporter_id <> reported_user_id),
  constraint match_chat_reports_reason_check
    check (reason in ('harassment', 'spam', 'inappropriate', 'impersonation', 'other')),
  constraint match_chat_reports_detail_length
    check (detail is null or (char_length(detail) between 1 and 500 and btrim(detail, E' \t\r\n') <> ''))
);

comment on table public.match_chat_reports is
  'Match chat safety reports. Visible only to admins (public.is_admin()); never visible to the reported user. Written only through private.report_match_chat.';

create index if not exists match_chat_reports_created_idx
  on public.match_chat_reports (created_at desc, id desc);
create index if not exists match_chat_reports_match_idx
  on public.match_chat_reports (match_id);
create index if not exists match_chat_reports_message_idx
  on public.match_chat_reports (message_id)
  where message_id is not null;
create index if not exists match_chat_reports_reporter_idx
  on public.match_chat_reports (reporter_id, created_at desc);
create index if not exists match_chat_reports_reported_user_idx
  on public.match_chat_reports (reported_user_id);

alter table public.match_chat_reports enable row level security;

revoke all on table public.match_chat_reports from public, anon, authenticated, service_role;
grant select on table public.match_chat_reports to authenticated;

drop policy if exists "match_chat_reports_read_admin" on public.match_chat_reports;
create policy "match_chat_reports_read_admin" on public.match_chat_reports
for select to authenticated
using (public.is_admin());

create index if not exists match_messages_match_sender_created_idx
  on public.match_messages (match_id, sender_id, created_at desc);

create or replace function private.get_match_chat_status(p_match_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  any_block boolean;
  mine boolean;
begin
  if actor is null then
    raise exception 'authentication_required'
      using errcode = '42501';
  end if;

  if p_match_id is null or not private.can_use_match_chat(p_match_id) then
    raise exception 'match_chat_forbidden'
      using errcode = '42501';
  end if;

  select
    exists (
      select 1
      from public.match_chat_blocks as b
      where b.match_id = p_match_id
    ),
    exists (
      select 1
      from public.match_chat_blocks as b
      where b.match_id = p_match_id
        and b.blocker_id = actor
    )
    into any_block, mine;

  return jsonb_build_object(
    'is_blocked', coalesce(any_block, false),
    'blocked_by_me', coalesce(mine, false)
  );
end;
$$;

revoke all on function private.get_match_chat_status(uuid) from public, anon, authenticated, service_role;
grant execute on function private.get_match_chat_status(uuid) to authenticated;

create or replace function private.block_match_chat(p_match_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  other_user_id uuid;
begin
  if actor is null then
    raise exception 'authentication_required'
      using errcode = '42501';
  end if;

  if p_match_id is null or not private.can_use_match_chat(p_match_id) then
    raise exception 'match_chat_forbidden'
      using errcode = '42501';
  end if;

  select
    case
      when match_row.user_a_id = actor then match_row.user_b_id
      else match_row.user_a_id
    end
    into other_user_id
  from public.matches as match_row
  where match_row.id = p_match_id;

  if other_user_id is null then
    raise exception 'match_chat_forbidden'
      using errcode = '42501';
  end if;

  insert into public.match_chat_blocks (match_id, blocker_id, blocked_user_id)
  values (p_match_id, actor, other_user_id)
  on conflict (match_id, blocker_id) do nothing;

  return jsonb_build_object(
    'is_blocked', true,
    'blocked_by_me', true
  );
end;
$$;

revoke all on function private.block_match_chat(uuid) from public, anon, authenticated, service_role;
grant execute on function private.block_match_chat(uuid) to authenticated;

create or replace function private.unblock_match_chat(p_match_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  removed_count integer := 0;
  still_blocked boolean := false;
begin
  if actor is null then
    raise exception 'authentication_required'
      using errcode = '42501';
  end if;

  if p_match_id is null or not private.can_use_match_chat(p_match_id) then
    raise exception 'match_chat_forbidden'
      using errcode = '42501';
  end if;

  delete from public.match_chat_blocks as b
  where b.match_id = p_match_id
    and b.blocker_id = actor;

  get diagnostics removed_count = row_count;

  select exists (
    select 1
    from public.match_chat_blocks as b
    where b.match_id = p_match_id
  )
    into still_blocked;

  if removed_count = 0 and still_blocked then
    raise exception 'match_chat_unblock_forbidden'
      using errcode = '42501';
  end if;

  return jsonb_build_object(
    'is_blocked', coalesce(still_blocked, false),
    'blocked_by_me', false
  );
end;
$$;

revoke all on function private.unblock_match_chat(uuid) from public, anon, authenticated, service_role;
grant execute on function private.unblock_match_chat(uuid) to authenticated;

create or replace function private.report_match_chat(
  p_match_id uuid,
  p_reason text,
  p_detail text default null,
  p_message_id uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  cleaned_reason text := btrim(coalesce(p_reason, ''), E' \t\r\n');
  cleaned_detail text := nullif(btrim(coalesce(p_detail, ''), E' \t\r\n'), '');
  other_user_id uuid;
  stored_id uuid;
  stored_created_at timestamptz;
begin
  if actor is null then
    raise exception 'authentication_required'
      using errcode = '42501';
  end if;

  if p_match_id is null or not private.can_use_match_chat(p_match_id) then
    raise exception 'match_chat_forbidden'
      using errcode = '42501';
  end if;

  if cleaned_reason not in ('harassment', 'spam', 'inappropriate', 'impersonation', 'other') then
    raise exception 'report_reason_invalid'
      using errcode = '22023';
  end if;

  if cleaned_detail is not null and char_length(cleaned_detail) > 500 then
    raise exception 'report_detail_too_long'
      using errcode = '22023';
  end if;

  if p_message_id is not null and not exists (
    select 1
    from public.match_messages as m
    where m.id = p_message_id
      and m.match_id = p_match_id
  ) then
    raise exception 'report_message_not_found'
      using errcode = '22023';
  end if;

  select
    case
      when match_row.user_a_id = actor then match_row.user_b_id
      else match_row.user_a_id
    end
    into other_user_id
  from public.matches as match_row
  where match_row.id = p_match_id;

  if other_user_id is null then
    raise exception 'match_chat_forbidden'
      using errcode = '42501';
  end if;

  insert into public.match_chat_reports (
    match_id,
    message_id,
    reporter_id,
    reported_user_id,
    reason,
    detail
  )
  values (
    p_match_id,
    p_message_id,
    actor,
    other_user_id,
    cleaned_reason,
    cleaned_detail
  )
  returning id, created_at into stored_id, stored_created_at;

  return jsonb_build_object(
    'id', stored_id,
    'created_at', stored_created_at
  );
end;
$$;

revoke all on function private.report_match_chat(uuid, text, text, uuid) from public, anon, authenticated, service_role;
grant execute on function private.report_match_chat(uuid, text, text, uuid) to authenticated;

create or replace function private.send_match_message(p_match_id uuid, p_body text)
returns public.match_messages
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  max_per_minute constant integer := 10;
  max_per_day constant integer := 100;
  actor uuid := auth.uid();
  cleaned text := btrim(coalesce(p_body, ''), E' \t\r\n');
  minute_count integer := 0;
  day_count integer := 0;
  stored public.match_messages;
begin
  if actor is null then
    raise exception 'authentication_required'
      using errcode = '42501';
  end if;

  if p_match_id is null or not private.can_use_match_chat(p_match_id) then
    raise exception 'match_chat_forbidden'
      using errcode = '42501';
  end if;

  if exists (
    select 1
    from public.match_chat_blocks as block_row
    where block_row.match_id = p_match_id
  ) then
    raise exception 'match_chat_blocked'
      using errcode = '42501';
  end if;

  if char_length(cleaned) < 1 or char_length(cleaned) > 1000 then
    raise exception 'message_invalid'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('match_chat_send:' || p_match_id::text || ':' || actor::text, 0)
  );

  select count(*)
    into minute_count
  from public.match_messages as recent
  where recent.match_id = p_match_id
    and recent.sender_id = actor
    and recent.created_at >= clock_timestamp() - interval '1 minute';

  if minute_count >= max_per_minute then
    raise exception 'match_chat_rate_limit_minute';
  end if;

  select count(*)
    into day_count
  from public.match_messages as recent
  where recent.match_id = p_match_id
    and recent.sender_id = actor
    and recent.created_at >= clock_timestamp() - interval '1 day';

  if day_count >= max_per_day then
    raise exception 'match_chat_rate_limit_day';
  end if;

  insert into public.match_messages (match_id, sender_id, body)
  values (p_match_id, actor, cleaned)
  returning * into stored;

  return stored;
end;
$$;

revoke all on function private.send_match_message(uuid, text) from public, anon, authenticated, service_role;
grant execute on function private.send_match_message(uuid, text) to authenticated;

create or replace function public.get_match_chat_status(p_match_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select private.get_match_chat_status(p_match_id);
$$;

revoke all on function public.get_match_chat_status(uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_match_chat_status(uuid) to authenticated;

create or replace function public.block_match_chat(p_match_id uuid)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.block_match_chat(p_match_id);
$$;

revoke all on function public.block_match_chat(uuid) from public, anon, authenticated, service_role;
grant execute on function public.block_match_chat(uuid) to authenticated;

create or replace function public.unblock_match_chat(p_match_id uuid)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.unblock_match_chat(p_match_id);
$$;

revoke all on function public.unblock_match_chat(uuid) from public, anon, authenticated, service_role;
grant execute on function public.unblock_match_chat(uuid) to authenticated;

create or replace function public.report_match_chat(
  p_match_id uuid,
  p_reason text,
  p_detail text default null,
  p_message_id uuid default null
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.report_match_chat(p_match_id, p_reason, p_detail, p_message_id);
$$;

revoke all on function public.report_match_chat(uuid, text, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.report_match_chat(uuid, text, text, uuid) to authenticated;
