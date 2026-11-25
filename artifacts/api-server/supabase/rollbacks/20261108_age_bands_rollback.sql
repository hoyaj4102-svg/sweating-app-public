-- Undo 20261108_age_bands.sql only.
-- Drops the age helpers and the birth_year lock. join_class, like_participant,
-- and revealed_participant_user_ids are dropped here because their 20261108
-- bodies call those helpers. The 20261107 rollback recreates join_class.
-- The 20261102 rollback drops like_participant and revealed_participant_user_ids
-- again if they are still present.
-- Do not run this against a hosted project from CI.

drop function if exists public.join_class(uuid, uuid);
drop function if exists public.like_participant(uuid, uuid);
drop function if exists public.revealed_participant_user_ids(uuid, uuid);

drop trigger if exists profiles_protect_birth_year on public.profiles;
drop function if exists public.protect_profiles_birth_year();
drop function if exists public.age_preferences_allow(integer, text, integer, text);
drop function if exists public.profile_age_band(integer);

alter table if exists public.profiles
  drop column if exists age_preference;
alter table if exists public.classes
  drop column if exists age_band;
