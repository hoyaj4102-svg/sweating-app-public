-- Undo 20261113_owner_announcements.sql only.
-- Drops principles, owner notices, and acknowledgements.
-- Drops gym_owners.approved_at. Earlier owner rows stay.
-- Does not drop schema private. Profile photo functions live there.
-- One transaction, so a failure leaves the photo functions in place.
-- Do not run this against a hosted project from CI.

begin;

drop trigger if exists owner_notice_ack_protect_truncate on public.owner_notice_acknowledgements;
drop trigger if exists owner_notice_ack_protect on public.owner_notice_acknowledgements;
drop trigger if exists announcements_protect_truncate on public.announcements;
drop trigger if exists announcements_protect on public.announcements;
drop trigger if exists gym_owners_protect_approved_at on public.gym_owners;

drop function if exists public.acknowledge_owner_principles(text);
drop table if exists public.owner_notice_acknowledgements;
drop table if exists public.announcements;
drop function if exists private.acknowledge_owner_principles(text);
drop function if exists private.is_approved_gym_owner();
drop function if exists public.protect_owner_notice_ack();
drop function if exists public.protect_announcements();
drop function if exists public.protect_gym_owner_approval();

drop index if exists public.gym_owners_approved_user_idx;
alter table if exists public.gym_owners
  drop column if exists approved_at;

commit;
