-- Undo 20261104_record_attendance.sql only.
-- Run this before the 20261102 rollback. Do not run it on a hosted Supabase
-- project from CI. Dropping gym_owners removes host rows. Attendance values
-- already stored on class_participants stay as they are.
-- After this file, direct attendance updates are allowed again and the like
-- trigger is gone. like_participant keeps the 20261104 body until the
-- 20261102 rollback drops it.

drop trigger if exists likes_enforce_participants on public.likes;
drop function if exists public.enforce_like_participants();

-- Drops the delegated mark_attendance too. The inspected production body is
-- not stored in this repo, so this does not restore it.
drop function if exists public.mark_attendance(uuid, uuid, text);
drop function if exists public.record_attendance(uuid, uuid, text);

drop trigger if exists class_participants_protect_attendance on public.class_participants;
drop function if exists public.protect_attendance_status();

drop policy if exists "participants_no_direct_update" on public.class_participants;

drop table if exists public.gym_owners;

grant select, insert, update, delete on table public.class_participants to anon, authenticated, service_role;
