-- Undo the trigger added by 20261106. Do not run against a hosted project from CI.
-- The class_participants revoke is already production state (2026-11-04 08:12 KST):
-- anon and authenticated keep SELECT only. This file does not grant INSERT or UPDATE.
-- 20261030 creates the same trigger. If that migration stays applied, re-run it
-- after this file so profiles_protect_is_admin comes back.

revoke all on table public.class_participants from public, anon, authenticated;
grant select on table public.class_participants to anon, authenticated;

drop trigger if exists profiles_protect_is_admin on public.profiles;
drop function if exists public.protect_profiles_is_admin();
