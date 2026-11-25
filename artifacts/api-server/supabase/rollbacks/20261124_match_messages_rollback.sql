-- Undo 20261124_match_messages.sql only.
-- Drops every stored match message. Matches, likes and the private schema stay.
-- One transaction. Do not run this against a hosted project from CI.

begin;

drop function if exists public.send_match_message(uuid, text);
drop function if exists public.list_match_messages(uuid, integer, timestamptz);
drop function if exists private.send_match_message(uuid, text);
drop function if exists private.list_match_messages(uuid, integer, timestamptz);
drop policy if exists "match_messages_read_members" on public.match_messages;
drop table if exists public.match_messages;
drop function if exists private.can_use_match_chat(uuid);

commit;
