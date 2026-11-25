#!/usr/bin/env bash
# Two sessions like each other while the first transaction still holds the
# pair lock. The second call must wait, then create exactly one match.
# Refuses Supabase hosts. Does not use production credentials.
set -euo pipefail

if [[ "${PGHOST:-}" == *supabase.co* || "${PGHOST:-}" == *supabase.com* ]]; then
  echo "Refusing to run SQL tests against a Supabase host." >&2
  exit 1
fi

if [[ -z "${PGDATABASE:-}" ]]; then
  echo "PGDATABASE is required." >&2
  exit 1
fi

race_psql() {
  if [[ "${USE_SUDO_POSTGRES:-}" == "1" ]]; then
    sudo -u postgres psql -v ON_ERROR_STOP=1 -X -d "${PGDATABASE}" "$@"
  else
    psql -v ON_ERROR_STOP=1 -X "$@"
  fi
}

CLASS_ID="30000000-0000-4000-8000-000000000014"
USER_A="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
USER_D="dddddddd-dddd-4ddd-8ddd-dddddddddddd"
LOCK_KEY="${CLASS_ID}:${USER_A}:${USER_D}"

race_psql <<SQL
begin;
select set_config('sweating.recording_attendance', 'on', true);
insert into public.classes (
  id, gym_id, title, sport_type, scheduled_at, duration_minutes, capacity, price, status
) values (
  '${CLASS_ID}',
  '10000000-0000-4000-8000-000000000099',
  'like race',
  '러닝',
  now() - interval '3 hours',
  60,
  8,
  0,
  'completed'
);
insert into public.class_participants (class_id, user_id, attendance_status) values
  ('${CLASS_ID}', '${USER_A}', 'attended'),
  ('${CLASS_ID}', '${USER_D}', 'attended');
commit;
SQL

session1_log="$(mktemp)"
session2_log="$(mktemp)"
cleanup() {
  rm -f "${session1_log}" "${session2_log}"
}
trap cleanup EXIT

(
  race_psql <<SQL
begin;
select pg_advisory_xact_lock(hashtextextended('${LOCK_KEY}', 0));
select pg_sleep(4);
select set_config('request.jwt.claim.sub', '${USER_A}', true);
select public.like_participant('${CLASS_ID}', '${USER_D}');
commit;
SQL
) >"${session1_log}" 2>&1 &
session1_pid=$!

lock_held=0
for _ in $(seq 1 50); do
  probe_log="$(mktemp)"
  set +e
  race_psql -c "set lock_timeout = '80ms'; select pg_advisory_lock(hashtextextended('${LOCK_KEY}', 0)); select pg_advisory_unlock(hashtextextended('${LOCK_KEY}', 0));" >"${probe_log}" 2>&1
  probe_status=$?
  set -e
  if [[ "${probe_status}" -ne 0 ]] && grep -q "lock timeout" "${probe_log}"; then
    lock_held=1
    rm -f "${probe_log}"
    break
  fi
  rm -f "${probe_log}"
  sleep 0.1
done
if [[ "${lock_held}" -ne 1 ]]; then
  echo "Session 1 did not take the pair lock." >&2
  cat "${session1_log}" >&2
  wait "${session1_pid}" || true
  exit 1
fi

start_ms="$(date +%s%3N)"
set +e
(
  race_psql -tA <<SQL
set statement_timeout = '15s';
select set_config('request.jwt.claim.sub', '${USER_D}', false);
select (public.like_participant('${CLASS_ID}', '${USER_A}') ->> 'matched');
SQL
) >"${session2_log}" 2>&1
session2_status=$?
set -e
end_ms="$(date +%s%3N)"

set +e
wait "${session1_pid}"
session1_status=$?
set -e
elapsed_ms="$((end_ms - start_ms))"

if [[ "${session1_status}" -ne 0 || "${session2_status}" -ne 0 ]]; then
  echo "Like race sessions failed (session1=${session1_status}, session2=${session2_status})." >&2
  echo "Session 1:" >&2
  cat "${session1_log}" >&2
  echo "Session 2:" >&2
  cat "${session2_log}" >&2
  exit 1
fi

matched="$(grep -E '^(t|f|true|false)$' "${session2_log}" | tail -n 1 || true)"
match_count="$(race_psql -tA -c "select count(*) from public.matches where class_id = '${CLASS_ID}'" | tr -d '[:space:]')"

if [[ "${matched}" != "t" && "${matched}" != "true" ]]; then
  echo "Second like did not observe the first like (matched=${matched})." >&2
  cat "${session2_log}" >&2
  exit 1
fi

if [[ "${match_count}" != "1" ]]; then
  echo "Race created ${match_count} matches." >&2
  exit 1
fi

if [[ "${elapsed_ms}" -lt 2000 ]]; then
  echo "Second like returned in ${elapsed_ms}ms, so it did not wait for the pair lock." >&2
  exit 1
fi

echo "PASS: overlapping likes wait and create exactly one match"
echo "LIKE_RACE_OK"
