-- Undo 20261122_revoke_anon_security_definer_execute.sql only.
-- Restores the grants and search_path those two functions had after
-- 20261104: anon, authenticated, and service_role can execute both, PUBLIC
-- cannot, and search_path is public. Does not drop the functions or the
-- likes trigger. Does not grant EXECUTE to PUBLIC.
-- Do not run this against a hosted project from CI or Preview.

alter function public.is_admin() set search_path = public;
alter function public.enforce_like_participants() set search_path = public;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated, service_role;

revoke all on function public.enforce_like_participants() from public;
grant execute on function public.enforce_like_participants() to anon, authenticated, service_role;
