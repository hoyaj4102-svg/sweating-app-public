-- Undo 20260914_sweating_sprint02.sql.
-- Deletes every like and match. Restores the Sprint 01 class read policy.
-- Run after the 20261102 rollback. Do not run this against a hosted project
-- from CI.

drop function if exists public.like_participant(uuid, uuid);
drop function if exists public.complete_class(uuid);

drop table if exists public.likes;
drop table if exists public.matches;

drop policy if exists "classes_read_published" on public.classes;
create policy "classes_read_published" on public.classes
for select to anon, authenticated
using (status = 'published' or public.is_admin());
