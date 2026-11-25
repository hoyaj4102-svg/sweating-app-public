-- Undo 20261102_attendance_reveal.sql.
-- Run after 20261104_record_attendance_rollback.sql and before the Sprint 02
-- rollback. like_participant and complete_class are dropped because their
-- 20261102 bodies call helpers this file removes. Re-apply
-- 20260914_sweating_sprint02.sql if those two functions are still required.
-- Existing class rows are not deleted. A class already marked completed stays
-- completed. Do not run this against a hosted project from CI.

drop function if exists public.like_participant(uuid, uuid);
drop function if exists public.complete_class(uuid);

drop trigger if exists classes_prevent_early_completion on public.classes;
drop function if exists public.prevent_early_class_completion();
drop function if exists public.revealed_participant_user_ids(uuid, uuid);
drop function if exists public.class_reveal_open(uuid);
drop function if exists public.class_scheduled_end(timestamptz, integer);
