-- Undo 20261114_consent_and_account_deletion.sql only.
-- One transaction. Does not drop schema private, storage policies, profile
-- photo functions, announcement tables, or gym_owners.approved_at.
-- Does not restore a deleted auth user.
-- Do not run this against a hosted project from CI.

begin;

drop trigger if exists profiles_z_require_consents on public.profiles;

drop function if exists public.delete_own_account();
drop function if exists public.assert_own_account_deletable();
drop function if exists public.delete_own_storage_objects(uuid);
drop function if exists public.enforce_profile_consents();
drop function if exists public.record_own_consents(boolean, boolean, boolean);
drop function if exists public.current_consents_complete();
drop function if exists public.consents_current(uuid);
drop function if exists public.current_consent_version();

drop table if exists public.user_consents;
drop table if exists public.account_deletion_log;

commit;
