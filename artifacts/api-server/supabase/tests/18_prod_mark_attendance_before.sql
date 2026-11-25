-- TEST ONLY. Runs against the approximate prod baseline, before 20261104.
-- Proves the fixture's mark_attendance works for an admin after the start
-- and refuses a non-admin. Do not run against a hosted project.

\set ON_ERROR_STOP on

insert into public.gyms (id, name, address, city)
values (
  '10000000-0000-4000-8000-000000000001',
  'baseline gym',
  'baseline',
  '예시시'
)
on conflict (id) do nothing;

insert into auth.users (id, email) values
  ('e4e4e4e4-e4e4-44e4-84e4-e4e4e4e4e4e4', 'baseline-admin@example.com'),
  ('e5e5e5e5-e5e5-45e5-85e5-e5e5e5e5e5e5', 'baseline-member@example.com');

insert into public.profiles (id, display_name, is_admin) values
  ('e4e4e4e4-e4e4-44e4-84e4-e4e4e4e4e4e4', 'Baseline Admin', true),
  ('e5e5e5e5-e5e5-45e5-85e5-e5e5e5e5e5e5', 'Baseline Member', false);

insert into public.classes (
  id, gym_id, title, sport_type, scheduled_at, duration_minutes, capacity, price, status
) values (
  '30000000-0000-4000-8000-0000000000b1',
  '10000000-0000-4000-8000-000000000001',
  'baseline started class',
  '러닝',
  now() - interval '30 minutes',
  60,
  8,
  0,
  'published'
);

insert into public.class_participants (id, class_id, user_id) values (
  '40000000-0000-4000-8000-0000000000b1',
  '30000000-0000-4000-8000-0000000000b1',
  'e5e5e5e5-e5e5-45e5-85e5-e5e5e5e5e5e5'
);

\echo 'PASS: prod mark_attendance lets an admin record after the start'

do $$
declare
  marked public.class_participants;
begin
  perform set_config('request.jwt.claim.sub', 'e4e4e4e4-e4e4-44e4-84e4-e4e4e4e4e4e4', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  marked := public.mark_attendance(
    '30000000-0000-4000-8000-0000000000b1',
    '40000000-0000-4000-8000-0000000000b1',
    'attended'
  );
  if marked.attendance_status is distinct from 'attended' then
    raise exception 'baseline mark_attendance returned %', marked.attendance_status;
  end if;
end $$;

\echo 'PASS: prod mark_attendance refuses a non-admin'

do $$
begin
  perform set_config('request.jwt.claim.sub', 'e5e5e5e5-e5e5-45e5-85e5-e5e5e5e5e5e5', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  perform public.mark_attendance(
    '30000000-0000-4000-8000-0000000000b1',
    '40000000-0000-4000-8000-0000000000b1',
    'no_show'
  );
  raise exception 'non-admin baseline mark_attendance succeeded';
exception
  when others then
    if sqlerrm not like '%admin_required%' then
      raise;
    end if;
end $$;

\echo 'PROD_MARK_BEFORE_OK'
