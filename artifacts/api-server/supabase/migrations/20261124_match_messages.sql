-- SWEATING / 20261124 match messages.
-- Do not apply to a hosted or production database without a separate a separate production review.
-- Preview uses the production database. Do not run this file there.
-- The Vercel build does not run SQL. CI applies it only to throwaway Postgres.
--
-- 1:1 messages between the two people of one existing match.
--
-- Who can use a conversation (private.can_use_match_chat):
--   * the caller is signed in (auth.uid() is not null),
--   * the caller is user_a_id or user_b_id of that match row,
--   * the match's class is completed and its scheduled end has passed
--     (the same reveal rule as public.class_reveal_open), and
--   * both people are still 'attended' in that class. If attendance is
--     reversed for either person, the conversation is closed for both.
-- Anyone else, including anon, a third participant of the same class, and a
-- pair with no match row, gets nothing.
--
-- Reads: RLS on public.match_messages lets authenticated read only rows of a
-- conversation they can use. The list function applies the same rule and
-- raises match_chat_forbidden instead of returning an empty list.
-- Writes: no role has INSERT, UPDATE or DELETE on the table. The only write
-- path is private.send_match_message, a SECURITY DEFINER function that
-- stores sender_id = auth.uid() after the same check. Body is trimmed and
-- must be 1 to 1000 characters; a CHECK constraint repeats the limit.
-- Messages go away with their match (on delete cascade) and with the
-- sender's account.
--
-- Style follows 20261113 and 20261122: definer functions live in private,
-- pin search_path to '', and are executable by authenticated only. The
-- public wrappers are one-line SECURITY INVOKER functions so the session JWT
-- can call them through the exposed public schema. Do not add the private
-- schema to the Data API exposed schemas.
--
-- This file does not add a block or report feature and does not change likes.
-- Idempotent: safe to run twice.

create schema if not exists private;

revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create table if not exists public.match_messages (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches (id) on delete cascade,
  sender_id uuid not null references auth.users (id) on delete cascade,
  body text not null,
  -- clock_timestamp keeps two messages sent in one transaction in order.
  created_at timestamptz not null default clock_timestamp(),
  constraint match_messages_body_length
    check (char_length(body) between 1 and 1000 and btrim(body, E' \t\r\n') <> '')
);

comment on table public.match_messages is
  'Messages between the two people of one match. Read through RLS or private.list_match_messages; write only through private.send_match_message.';

create index if not exists match_messages_match_created_idx
  on public.match_messages (match_id, created_at desc, id desc);
create index if not exists match_messages_sender_idx
  on public.match_messages (sender_id);

alter table public.match_messages enable row level security;

revoke all on table public.match_messages from public, anon, authenticated, service_role;
grant select on table public.match_messages to authenticated;

create or replace function private.can_use_match_chat(p_match_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.matches as match_row
    join public.classes as class_row on class_row.id = match_row.class_id
    where match_row.id = p_match_id
      and auth.uid() is not null
      and auth.uid() in (match_row.user_a_id, match_row.user_b_id)
      and class_row.status = 'completed'
      and now() >= class_row.scheduled_at + make_interval(mins => class_row.duration_minutes)
      and exists (
        select 1
        from public.class_participants as side_a
        where side_a.class_id = match_row.class_id
          and side_a.user_id = match_row.user_a_id
          and side_a.attendance_status = 'attended'
      )
      and exists (
        select 1
        from public.class_participants as side_b
        where side_b.class_id = match_row.class_id
          and side_b.user_id = match_row.user_b_id
          and side_b.attendance_status = 'attended'
      )
  );
$$;

revoke all on function private.can_use_match_chat(uuid) from public, anon, authenticated, service_role;
grant execute on function private.can_use_match_chat(uuid) to authenticated;

drop policy if exists "match_messages_read_members" on public.match_messages;
create policy "match_messages_read_members" on public.match_messages
for select to authenticated
using (private.can_use_match_chat(match_id));

create or replace function private.list_match_messages(
  p_match_id uuid,
  p_limit integer default 50,
  p_before timestamptz default null
)
returns setof public.match_messages
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  page_size integer := least(greatest(coalesce(p_limit, 50), 1), 100);
begin
  if auth.uid() is null then
    raise exception 'authentication_required'
      using errcode = '42501';
  end if;

  if p_match_id is null or not private.can_use_match_chat(p_match_id) then
    raise exception 'match_chat_forbidden'
      using errcode = '42501';
  end if;

  return query
  select message.*
  from public.match_messages as message
  where message.match_id = p_match_id
    and (p_before is null or message.created_at < p_before)
  order by message.created_at desc, message.id desc
  limit page_size;
end;
$$;

revoke all on function private.list_match_messages(uuid, integer, timestamptz) from public, anon, authenticated, service_role;
grant execute on function private.list_match_messages(uuid, integer, timestamptz) to authenticated;

create or replace function private.send_match_message(p_match_id uuid, p_body text)
returns public.match_messages
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  cleaned text := btrim(coalesce(p_body, ''), E' \t\r\n');
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

  if char_length(cleaned) < 1 or char_length(cleaned) > 1000 then
    raise exception 'message_invalid'
      using errcode = '22023';
  end if;

  insert into public.match_messages (match_id, sender_id, body)
  values (p_match_id, actor, cleaned)
  returning * into stored;

  return stored;
end;
$$;

revoke all on function private.send_match_message(uuid, text) from public, anon, authenticated, service_role;
grant execute on function private.send_match_message(uuid, text) to authenticated;

create or replace function public.list_match_messages(
  p_match_id uuid,
  p_limit integer default 50,
  p_before timestamptz default null
)
returns setof public.match_messages
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.list_match_messages(p_match_id, p_limit, p_before);
$$;

revoke all on function public.list_match_messages(uuid, integer, timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.list_match_messages(uuid, integer, timestamptz) to authenticated;

create or replace function public.send_match_message(p_match_id uuid, p_body text)
returns public.match_messages
language sql
volatile
security invoker
set search_path = ''
as $$
  select * from private.send_match_message(p_match_id, p_body);
$$;

revoke all on function public.send_match_message(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.send_match_message(uuid, text) to authenticated;
