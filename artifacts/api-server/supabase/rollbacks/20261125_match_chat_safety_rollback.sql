-- Undo 20261125_match_chat_safety.sql only.
-- Drops blocks, reports, and restores 20261124 private.send_match_message.
-- Keeps public.match_messages and matches. One transaction.
-- Do not run this against a hosted project from CI.

begin;

drop function if exists public.report_match_chat(uuid, text, text, uuid);
drop function if exists public.unblock_match_chat(uuid);
drop function if exists public.block_match_chat(uuid);
drop function if exists public.get_match_chat_status(uuid);

drop function if exists private.report_match_chat(uuid, text, text, uuid);
drop function if exists private.unblock_match_chat(uuid);
drop function if exists private.block_match_chat(uuid);
drop function if exists private.get_match_chat_status(uuid);

drop policy if exists "match_chat_reports_read_admin" on public.match_chat_reports;
drop table if exists public.match_chat_reports;

drop policy if exists "match_chat_blocks_read_own" on public.match_chat_blocks;
drop table if exists public.match_chat_blocks;

drop index if exists public.match_messages_match_sender_created_idx;

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

commit;
