-- Undo 20260905_sweating_v0.sql.
-- Drops profiles, gyms, classes, participants, and the join helper.
-- This deletes those rows. Run this last. Do not run this against a hosted
-- project from CI.

drop trigger if exists profiles_set_updated_at on public.profiles;

-- These policies call is_admin(). Drop them before the function.
-- classes_read_published is recreated by the sprint 02 rollback.
drop policy if exists "profiles_read_self" on public.profiles;
drop policy if exists "participants_read_self" on public.class_participants;
drop policy if exists "classes_read_published" on public.classes;

drop function if exists public.join_class(uuid, uuid);
drop function if exists public.is_admin();
drop function if exists public.set_updated_at();

drop table if exists public.class_participants;
drop table if exists public.classes;
drop table if exists public.gyms;
drop table if exists public.profiles;

drop extension if exists pgcrypto;
