-- SWEATING / 20261122
-- tracked change. Stop anonymous clients from calling two SECURITY DEFINER functions.
-- Supabase advisor 0028 flags public.is_admin() and
-- public.enforce_like_participants() because anon can execute them through
-- /rest/v1/rpc. PUBLIC already has no EXECUTE on the hosted database; this
-- file revokes it again so a default grant cannot linger.
--
-- Filename 20261122 sorts after Draft PR #67's 20261121_three_age_bands.sql.
-- The two drafts do not edit the same file.
--
-- Do not apply this file to the hosted project from Preview, CI, or a
-- client. Preview uses the production database. The Vercel build does not
-- run SQL. Apply only with a separate production review.
--
-- Idempotent. CREATE OR REPLACE is not used, so function bodies stay as
-- they are. ALTER FUNCTION only pins search_path. REVOKE and GRANT can run
-- again.
--
-- Re-applying 20260914 grants anon EXECUTE on is_admin() again. Re-applying
-- 20261104 grants anon and authenticated EXECUTE on
-- enforce_like_participants() again. A full pass must keep this file last.
--
-- is_admin() stays executable by authenticated and service_role. Signed-in
-- RLS policies call it as the current role: profiles_read_self,
-- participants_read_self, classes_read_authenticated, gyms_admin_insert,
-- and gyms_admin_update. The anon class policy is status = 'published' and
-- does not call is_admin(). This file refuses to revoke if an anon or
-- public policy still calls either function.
--
-- enforce_like_participants() is the BEFORE INSERT trigger on likes.
-- like_participant() is SECURITY DEFINER, so the trigger runs as the
-- function owner. Authenticated clients have no INSERT on likes.
-- Authenticated EXECUTE is revoked so the trigger function is not an RPC.
-- service_role keeps EXECUTE because that role can insert and bypass RLS.
-- The owner keeps EXECUTE through ownership.
--
-- Both bodies already qualify public.* and auth.uid(). search_path was
-- public. Pin it to an empty string so a later object in public cannot
-- shadow a name. Rollback restores search_path = public.

do $$
declare
  blocking text;
begin
  if to_regprocedure('public.is_admin()') is null
     or to_regprocedure('public.enforce_like_participants()') is null then
    raise exception 'public.is_admin() or public.enforce_like_participants() is missing';
  end if;

  select string_agg(
    format('%I.%I %I', schemaname, tablename, policyname),
    ', ' order by schemaname, tablename, policyname
  )
    into blocking
  from pg_catalog.pg_policies
  where roles && array['anon', 'public']::name[]
    and (
      coalesce(qual, '') ilike '%is_admin(%'
      or coalesce(with_check, '') ilike '%is_admin(%'
      or coalesce(qual, '') ilike '%enforce_like_participants(%'
      or coalesce(with_check, '') ilike '%enforce_like_participants(%'
    );

  if blocking is not null then
    raise exception 'anon or public policy still calls a locked function: %', blocking;
  end if;
end $$;

alter function public.is_admin() set search_path = '';
alter function public.enforce_like_participants() set search_path = '';

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated, service_role;

revoke all on function public.enforce_like_participants() from public, anon, authenticated;
grant execute on function public.enforce_like_participants() to service_role;
