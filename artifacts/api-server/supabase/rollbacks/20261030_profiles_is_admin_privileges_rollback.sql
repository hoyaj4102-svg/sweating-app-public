-- Undo 20261030_profiles_is_admin_privileges.sql.
-- Restores table-level INSERT and UPDATE on profiles. A table-level grant
-- overrides the column-level revoke, which is how a client could set
-- is_admin again. Profile rows are not deleted. birth_date is left in place
-- because production already has that column and dropping it would delete
-- values. Do not run this against a hosted project from CI.

drop trigger if exists profiles_protect_is_admin on public.profiles;
drop function if exists public.protect_profiles_is_admin();

grant insert, update on table public.profiles to anon, authenticated;
