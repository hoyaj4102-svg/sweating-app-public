-- Remaining seats across join, double join, cancel, and rejoin.
-- A bookable seat is held while attendance_status is registered or attended.
-- Cancelled and no_show do not hold a seat. Rejoin reactivates the same
-- cancelled row. A second row is not inserted.
-- Runs on the throwaway CI database only. Do not point this at a hosted project.

\set ON_ERROR_STOP on

\echo 'PASS seat setup'

create or replace function pg_temp.holding(p_class uuid)
returns integer
language sql
stable
as $$
  select count(*)::integer
  from public.class_participants
  where class_id = p_class
    and attendance_status in ('registered', 'attended');
$$;

create or replace function pg_temp.row_count(p_class uuid)
returns integer
language sql
stable
as $$
  select count(*)::integer
  from public.class_participants
  where class_id = p_class;
$$;

-- Throws unless class_seat_counts and the row count agree.
create or replace function pg_temp.assert_seats(
  p_class uuid,
  p_user uuid,
  p_occupied integer,
  p_joined boolean
)
returns void
language plpgsql
as $$
declare
  found_occupied integer;
  found_joined boolean;
begin
  select counts.occupied, counts.is_joined
    into found_occupied, found_joined
  from public.class_seat_counts(array[p_class], p_user) as counts;

  if found_occupied is distinct from p_occupied
     or found_joined is distinct from p_joined then
    raise exception 'snapshot user % occupied % joined %, expected occupied % joined %',
      p_user, found_occupied, found_joined, p_occupied, p_joined;
  end if;

  if pg_temp.holding(p_class) is distinct from p_occupied then
    raise exception 'holding % does not match occupied %', pg_temp.holding(p_class), p_occupied;
  end if;
end;
$$;

do $$
begin
  delete from public.class_participants
  where class_id in (
      'c2000000-0000-4000-8000-000000000071',
      'c2000000-0000-4000-8000-000000000072',
      'c2000000-0000-4000-8000-000000000073',
      'c2000000-0000-4000-8000-000000000074'
    )
    or user_id in (
      'c3000000-0000-4000-8000-0000000000a1',
      'c3000000-0000-4000-8000-0000000000b2',
      'c3000000-0000-4000-8000-0000000000c3'
    );

  delete from public.classes
  where id in (
    'c2000000-0000-4000-8000-000000000071',
    'c2000000-0000-4000-8000-000000000072',
    'c2000000-0000-4000-8000-000000000073',
    'c2000000-0000-4000-8000-000000000074'
  );

  delete from public.gyms
  where id = 'c1000000-0000-4000-8000-000000000071';

  delete from auth.users
  where id in (
    'c3000000-0000-4000-8000-0000000000a1',
    'c3000000-0000-4000-8000-0000000000b2',
    'c3000000-0000-4000-8000-0000000000c3'
  );
end $$;

insert into auth.users (id, email) values
  ('c3000000-0000-4000-8000-0000000000a1', 'seat-a@example.com'),
  ('c3000000-0000-4000-8000-0000000000b2', 'seat-b@example.com'),
  ('c3000000-0000-4000-8000-0000000000c3', 'seat-c@example.com');

insert into public.gyms (id, name, address, city)
values ('c1000000-0000-4000-8000-000000000071', 'Seat Gym', 'Busan', 'Busan');

insert into public.classes (
  id, gym_id, title, sport_type, scheduled_at, duration_minutes, capacity, price, status
) values
  (
    'c2000000-0000-4000-8000-000000000071',
    'c1000000-0000-4000-8000-000000000071',
    'rejoin class',
    '러닝',
    now() + interval '4 days',
    60,
    2,
    0,
    'published'
  ),
  (
    'c2000000-0000-4000-8000-000000000072',
    'c1000000-0000-4000-8000-000000000071',
    'cancel class',
    '러닝',
    now() + interval '4 days',
    60,
    1,
    0,
    'published'
  ),
  (
    'c2000000-0000-4000-8000-000000000073',
    'c1000000-0000-4000-8000-000000000071',
    'noshow class',
    '러닝',
    now() + interval '4 days',
    60,
    1,
    0,
    'published'
  ),
  (
    'c2000000-0000-4000-8000-000000000074',
    'c1000000-0000-4000-8000-000000000071',
    'started class',
    '러닝',
    now() + interval '4 days',
    60,
    1,
    0,
    'published'
  );

\echo 'PASS seat: join then double join keeps one row'

do $$
declare
  seat_class uuid := 'c2000000-0000-4000-8000-000000000071';
  user_a uuid := 'c3000000-0000-4000-8000-0000000000a1';
  joined public.class_participants;
  rejoined public.class_participants;
  holding integer;
  all_rows integer;
begin
  execute 'set local role service_role';
  joined := public.join_class(seat_class, user_a);
  if joined.attendance_status is distinct from 'registered' then
    raise exception 'first join status %', joined.attendance_status;
  end if;
  if pg_temp.holding(seat_class) is distinct from 1 or pg_temp.row_count(seat_class) is distinct from 1 then
    raise exception 'first join holding % rows %', pg_temp.holding(seat_class), pg_temp.row_count(seat_class);
  end if;

  begin
    perform public.join_class(seat_class, user_a);
    raise exception 'double join succeeded';
  exception
    when others then
      if sqlerrm = 'double join succeeded' then
        raise;
      end if;
      if sqlerrm is distinct from 'already_joined' then
        raise exception 'double join error %', sqlerrm;
      end if;
  end;

  if pg_temp.holding(seat_class) is distinct from 1 or pg_temp.row_count(seat_class) is distinct from 1 then
    raise exception 'double join changed holding % rows %', pg_temp.holding(seat_class), pg_temp.row_count(seat_class);
  end if;

  -- Stored cancelled row: the same shape a cancel leaves behind.
  -- The recording flag is test setup only. The product path is cancel_class_seat.
  execute 'reset role';
  perform set_config('sweating.recording_attendance', 'on', true);
  update public.class_participants
  set attendance_status = 'cancelled'
  where id = joined.id;
  perform set_config('sweating.recording_attendance', 'off', true);

  select
    count(*) filter (where attendance_status in ('registered', 'attended')),
    count(*)
  into holding, all_rows
  from public.class_participants
  where class_id = seat_class;

  if holding is distinct from 0 or all_rows is distinct from 1 then
    raise exception 'cancelled row setup holding % rows %', holding, all_rows;
  end if;
  if (2 - holding) = (2 - all_rows) then
    raise exception 'cancelled row did not free a seat';
  end if;

  execute 'set local role service_role';
  begin
    rejoined := public.join_class(seat_class, user_a);
  exception
    when others then
      raise exception 'SEAT_REJOIN_FAILED: %', sqlerrm;
  end;

  if rejoined.id is distinct from joined.id then
    raise exception 'rejoin inserted a second participant row';
  end if;
  if rejoined.attendance_status is distinct from 'registered' then
    raise exception 'rejoin status %', rejoined.attendance_status;
  end if;
  if pg_temp.holding(seat_class) is distinct from 1 or pg_temp.row_count(seat_class) is distinct from 1 then
    raise exception 'rejoin holding % rows %', pg_temp.holding(seat_class), pg_temp.row_count(seat_class);
  end if;

  execute 'reset role';
  perform pg_temp.assert_seats(seat_class, user_a, 1, true);
  perform pg_temp.assert_seats(seat_class, 'c3000000-0000-4000-8000-0000000000b2', 1, false);
end $$;

\echo 'PASS seat: cancel, rejoin, and cancel after rejoin'

do $$
declare
  seat_class uuid := 'c2000000-0000-4000-8000-000000000072';
  user_a uuid := 'c3000000-0000-4000-8000-0000000000a1';
  user_b uuid := 'c3000000-0000-4000-8000-0000000000b2';
  user_c uuid := 'c3000000-0000-4000-8000-0000000000c3';
  joined public.class_participants;
  cancelled public.class_participants;
  again public.class_participants;
  rejoined public.class_participants;
begin
  execute 'set local role service_role';
  joined := public.join_class(seat_class, user_a);
  execute 'reset role';
  perform pg_temp.assert_seats(seat_class, user_a, 1, true);
  perform pg_temp.assert_seats(seat_class, user_b, 1, false);

  execute 'set local role service_role';
  begin
    perform public.join_class(seat_class, user_a);
    raise exception 'double join succeeded';
  exception
    when others then
      if sqlerrm = 'double join succeeded' then
        raise;
      end if;
      if sqlerrm is distinct from 'already_joined' then
        raise exception 'double join error %', sqlerrm;
      end if;
  end;

  begin
    perform public.join_class(seat_class, user_b);
    raise exception 'second member joined a full class';
  exception
    when others then
      if sqlerrm = 'second member joined a full class' then
        raise;
      end if;
      if sqlerrm is distinct from 'class_full' then
        raise exception 'full class error %', sqlerrm;
      end if;
  end;

  if pg_temp.holding(seat_class) is distinct from 1 or pg_temp.row_count(seat_class) is distinct from 1 then
    raise exception 'full class holding % rows %', pg_temp.holding(seat_class), pg_temp.row_count(seat_class);
  end if;

  cancelled := public.cancel_class_seat(seat_class, user_a);
  if cancelled.id is distinct from joined.id or cancelled.attendance_status is distinct from 'cancelled' then
    raise exception 'cancel returned % %', cancelled.id, cancelled.attendance_status;
  end if;
  again := public.cancel_class_seat(seat_class, user_a);
  if again.id is distinct from joined.id or again.attendance_status is distinct from 'cancelled' then
    raise exception 'second cancel returned % %', again.id, again.attendance_status;
  end if;

  execute 'reset role';
  perform pg_temp.assert_seats(seat_class, user_a, 0, false);
  if pg_temp.row_count(seat_class) is distinct from 1 then
    raise exception 'cancel inserted or deleted a row, count %', pg_temp.row_count(seat_class);
  end if;

  execute 'set local role service_role';
  perform public.join_class(seat_class, user_b);
  begin
    perform public.join_class(seat_class, user_a);
    raise exception 'rejoin took a held seat';
  exception
    when others then
      if sqlerrm = 'rejoin took a held seat' then
        raise;
      end if;
      if sqlerrm is distinct from 'class_full' then
        raise exception 'rejoin while full error %', sqlerrm;
      end if;
  end;

  execute 'reset role';
  perform pg_temp.assert_seats(seat_class, user_a, 1, false);
  perform pg_temp.assert_seats(seat_class, user_b, 1, true);
  if pg_temp.row_count(seat_class) is distinct from 2 then
    raise exception 'full rejoin row count %', pg_temp.row_count(seat_class);
  end if;

  execute 'set local role service_role';
  perform public.cancel_class_seat(seat_class, user_b);
  rejoined := public.join_class(seat_class, user_a);
  if rejoined.id is distinct from joined.id or rejoined.attendance_status is distinct from 'registered' then
    raise exception 'rejoin after the other cancel returned % %', rejoined.id, rejoined.attendance_status;
  end if;
  begin
    perform public.join_class(seat_class, user_a);
    raise exception 'double join after rejoin succeeded';
  exception
    when others then
      if sqlerrm = 'double join after rejoin succeeded' then
        raise;
      end if;
      if sqlerrm is distinct from 'already_joined' then
        raise exception 'double join after rejoin error %', sqlerrm;
      end if;
  end;

  cancelled := public.cancel_class_seat(seat_class, user_a);
  if cancelled.id is distinct from joined.id or cancelled.attendance_status is distinct from 'cancelled' then
    raise exception 'cancel after rejoin returned % %', cancelled.id, cancelled.attendance_status;
  end if;

  execute 'reset role';
  perform pg_temp.assert_seats(seat_class, user_a, 0, false);
  perform pg_temp.assert_seats(seat_class, user_b, 0, false);
  if pg_temp.row_count(seat_class) is distinct from 2 then
    raise exception 'cancel after rejoin row count %', pg_temp.row_count(seat_class);
  end if;

  -- The seat freed by the second cancel is one seat, not both rows.
  execute 'set local role service_role';
  perform public.join_class(seat_class, user_c);
  begin
    perform public.join_class(seat_class, user_a);
    raise exception 'rejoin after a new holder succeeded';
  exception
    when others then
      if sqlerrm = 'rejoin after a new holder succeeded' then
        raise;
      end if;
      if sqlerrm is distinct from 'class_full' then
        raise exception 'late rejoin error %', sqlerrm;
      end if;
  end;

  execute 'reset role';
  perform pg_temp.assert_seats(seat_class, user_c, 1, true);
  perform pg_temp.assert_seats(seat_class, user_a, 1, false);
end $$;

\echo 'PASS seat: no_show frees the seat and a started class cannot be cancelled'

do $$
declare
  noshow_class uuid := 'c2000000-0000-4000-8000-000000000073';
  started_class uuid := 'c2000000-0000-4000-8000-000000000074';
  user_a uuid := 'c3000000-0000-4000-8000-0000000000a1';
  user_b uuid := 'c3000000-0000-4000-8000-0000000000b2';
  joined public.class_participants;
  taken public.class_participants;
begin
  execute 'set local role service_role';
  joined := public.join_class(noshow_class, user_a);
  perform public.join_class(started_class, user_a);
  execute 'reset role';

  perform set_config('sweating.recording_attendance', 'on', true);
  update public.class_participants
  set attendance_status = 'no_show'
  where id = joined.id;
  perform set_config('sweating.recording_attendance', 'off', true);

  -- no_show does not hold a bookable seat. The row stays, so this person cannot
  -- reactivate it; someone else can take the seat.
  execute 'reset role';
  perform pg_temp.assert_seats(noshow_class, user_a, 0, true);
  if pg_temp.row_count(noshow_class) is distinct from 1 then
    raise exception 'no_show row count %', pg_temp.row_count(noshow_class);
  end if;

  execute 'set local role service_role';
  begin
    perform public.join_class(noshow_class, user_a);
    raise exception 'no_show rejoin succeeded';
  exception
    when others then
      if sqlerrm = 'no_show rejoin succeeded' then
        raise;
      end if;
      if sqlerrm is distinct from 'already_joined' then
        raise exception 'no_show rejoin error %', sqlerrm;
      end if;
  end;

  taken := public.join_class(noshow_class, user_b);
  if taken.user_id is distinct from user_b or taken.attendance_status is distinct from 'registered' then
    raise exception 'no_show seat was not free for the next member';
  end if;

  begin
    perform public.cancel_class_seat(noshow_class, user_a);
    raise exception 'no_show cancel succeeded';
  exception
    when others then
      if sqlerrm = 'no_show cancel succeeded' then
        raise;
      end if;
      if sqlerrm is distinct from 'seat_not_cancellable' then
        raise exception 'no_show cancel error %', sqlerrm;
      end if;
  end;

  execute 'reset role';
  perform pg_temp.assert_seats(noshow_class, user_a, 1, true);
  perform pg_temp.assert_seats(noshow_class, user_b, 1, true);
  if pg_temp.row_count(noshow_class) is distinct from 2 then
    raise exception 'no_show plus next member row count %', pg_temp.row_count(noshow_class);
  end if;

  update public.classes
  set scheduled_at = now() - interval '1 minute'
  where id = started_class;

  execute 'set local role service_role';
  begin
    perform public.cancel_class_seat(started_class, user_a);
    raise exception 'started class cancel succeeded';
  exception
    when others then
      if sqlerrm = 'started class cancel succeeded' then
        raise;
      end if;
      if sqlerrm is distinct from 'class_started' then
        raise exception 'started cancel error %', sqlerrm;
      end if;
  end;

  execute 'reset role';
  perform pg_temp.assert_seats(started_class, user_a, 1, true);
end $$;

\echo 'PASS seat: client roles cannot move a seat or read the snapshot'

do $$
declare
  seat_class uuid := 'c2000000-0000-4000-8000-000000000071';
  user_a uuid := 'c3000000-0000-4000-8000-0000000000a1';
  status text;
begin
  if has_function_privilege('anon', 'public.cancel_class_seat(uuid,uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.cancel_class_seat(uuid,uuid)', 'EXECUTE') then
    raise exception 'a client role can execute cancel_class_seat';
  end if;
  if has_function_privilege('anon', 'public.class_seat_counts(uuid[],uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.class_seat_counts(uuid[],uuid)', 'EXECUTE') then
    raise exception 'a client role can execute class_seat_counts';
  end if;
  if has_function_privilege('anon', 'public.join_class(uuid,uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.join_class(uuid,uuid)', 'EXECUTE') then
    raise exception 'a client role can execute join_class';
  end if;
  if not has_function_privilege('service_role', 'public.cancel_class_seat(uuid,uuid)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.class_seat_counts(uuid[],uuid)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.join_class(uuid,uuid)', 'EXECUTE') then
    raise exception 'service_role lost a seat function';
  end if;

  execute 'set local role service_role';
  perform public.class_seat_counts(array[seat_class], user_a);

  perform set_config('sweating.seat_hold', 'on', true);
  begin
    update public.class_participants
    set attendance_status = 'cancelled'
    where class_id = seat_class
      and user_id = user_a;
    raise exception 'service_role changed attendance';
  exception
    when others then
      if sqlerrm = 'service_role changed attendance' then
        raise;
      end if;
      if sqlerrm is distinct from 'attendance_change_forbidden' then
        raise exception 'service_role attendance update error %', sqlerrm;
      end if;
  end;
  perform set_config('sweating.seat_hold', 'off', true);
  execute 'reset role';

  select attendance_status into status
  from public.class_participants
  where class_id = seat_class
    and user_id = user_a;
  if status is distinct from 'registered' then
    raise exception 'forbidden update changed status to %', status;
  end if;

  -- The seat flag only moves registered <-> cancelled. It does not mark attended.
  perform set_config('sweating.seat_hold', 'on', true);
  begin
    update public.class_participants
    set attendance_status = 'attended'
    where class_id = seat_class
      and user_id = user_a;
    raise exception 'seat_hold allowed attended';
  exception
    when others then
      if sqlerrm = 'seat_hold allowed attended' then
        raise;
      end if;
      if sqlerrm is distinct from 'attendance_change_forbidden' then
        raise exception 'seat_hold attended error %', sqlerrm;
      end if;
  end;
  perform set_config('sweating.seat_hold', 'off', true);
end $$;

\echo 'SEAT_HOLDS_OK'
