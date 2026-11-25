#!/usr/bin/env bash
# Apply repo migrations to a local or CI Postgres and run privilege/reveal asserts.
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

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATIONS_DIR="$(cd "${SCRIPT_DIR}/../migrations" && pwd)"

run_psql() {
  if [[ "${USE_SUDO_POSTGRES:-}" == "1" ]]; then
    sudo -u postgres psql -v ON_ERROR_STOP=1 -X -d "${PGDATABASE}" "$@"
  else
    psql -v ON_ERROR_STOP=1 -X "$@"
  fi
}

if [[ ! "${PGDATABASE}" =~ ^[A-Za-z0-9_]+$ ]]; then
  echo "PGDATABASE must be a simple identifier." >&2
  exit 1
fi

echo "SQL test database: ${PGDATABASE} host=${PGHOST:-local}"
run_psql -tAc "select current_setting('server_version');"

previous=""
required_1030=""
required_1102=""
required_1104=""
required_1106=""
required_1107=""
required_1108=""
required_1112_owner=""
required_1112_photo=""
required_1113=""
required_1114=""
required_1121=""
required_1122=""
required_1124=""
required_1125=""
for migration in "${MIGRATIONS_DIR}"/*.sql; do
  name="$(basename "${migration}")"
  if [[ -n "${previous}" && "${name}" < "${previous}" ]]; then
    echo "Migrations are not in lexical order: ${previous} then ${name}" >&2
    exit 1
  fi
  case "${name}" in
    20261030_profiles_is_admin_privileges.sql) required_1030="1" ;;
    20261102_attendance_reveal.sql) required_1102="1" ;;
    20261104_record_attendance.sql) required_1104="1" ;;
    20261106_revoke_participant_client_writes.sql) required_1106="1" ;;
    20261107_class_seat_holds.sql) required_1107="1" ;;
    20261108_age_bands.sql) required_1108="1" ;;
    20261112_gym_owner_classes.sql) required_1112_owner="1" ;;
    20261112_profile_photo_storage.sql) required_1112_photo="1" ;;
    20261113_owner_announcements.sql) required_1113="1" ;;
    20261114_consent_and_account_deletion.sql) required_1114="1" ;;
    20261121_three_age_bands.sql) required_1121="1" ;;
    20261122_revoke_anon_security_definer_execute.sql) required_1122="1" ;;
    20261124_match_messages.sql) required_1124="1" ;;
    20261125_match_chat_safety.sql) required_1125="1" ;;
  esac
  if [[ -n "${required_1102}" && -z "${required_1030}" ]]; then
    echo "20261102 is ordered before 20261030" >&2
    exit 1
  fi
  if [[ -n "${required_1104}" && -z "${required_1102}" ]]; then
    echo "20261104 is ordered before 20261102" >&2
    exit 1
  fi
  if [[ -n "${required_1106}" && -z "${required_1104}" ]]; then
    echo "20261106 is ordered before 20261104" >&2
    exit 1
  fi
  if [[ -n "${required_1107}" && -z "${required_1106}" ]]; then
    echo "20261107 is ordered before 20261106" >&2
    exit 1
  fi
  if [[ -n "${required_1108}" && -z "${required_1107}" ]]; then
    echo "20261108 is ordered before 20261107" >&2
    exit 1
  fi
  if [[ ( -n "${required_1112_owner}" || -n "${required_1112_photo}" ) && -z "${required_1108}" ]]; then
    echo "20261112 is ordered before 20261108" >&2
    exit 1
  fi
  if [[ -n "${required_1113}" && ( -z "${required_1112_owner}" || -z "${required_1112_photo}" ) ]]; then
    echo "20261113 is ordered before a 20261112 migration" >&2
    exit 1
  fi
  if [[ -n "${required_1114}" && -z "${required_1113}" ]]; then
    echo "20261114 is ordered before 20261113" >&2
    exit 1
  fi
  if [[ -n "${required_1121}" && -z "${required_1114}" ]]; then
    echo "20261121 is ordered before 20261114" >&2
    exit 1
  fi
  if [[ -n "${required_1122}" && -z "${required_1121}" ]]; then
    echo "20261122 is ordered before 20261121" >&2
    exit 1
  fi
  if [[ -n "${required_1124}" && -z "${required_1122}" ]]; then
    echo "20261124 is ordered before 20261122" >&2
    exit 1
  fi
  if [[ -n "${required_1125}" && -z "${required_1124}" ]]; then
    echo "20261125 is ordered before 20261124" >&2
    exit 1
  fi
  previous="${name}"
done
if [[ -z "${required_1030}" || -z "${required_1102}" || -z "${required_1104}" || -z "${required_1106}" || -z "${required_1107}" || -z "${required_1108}" || -z "${required_1112_owner}" || -z "${required_1112_photo}" || -z "${required_1113}" || -z "${required_1114}" || -z "${required_1121}" || -z "${required_1122}" || -z "${required_1124}" || -z "${required_1125}" ]]; then
  echo "Missing a required migration (20261030, 20261102, 20261104, 20261106, 20261107, 20261108, 20261112 gym owner, 20261112 profile photo, 20261113, 20261114, 20261121, 20261122, 20261124, 20261125)." >&2
  exit 1
fi
echo "MIGRATION_ORDER_OK $(basename -a "${MIGRATIONS_DIR}"/*.sql | tr '\n' ' ')"
echo "20261102 and 20261104 both replace like_participant. A full pass keeps 20261104, then 20261106, then 20261107. 20261107 replaces protect_attendance_status. Re-applying 20261104 alone after 20261107 would reject seat cancel and rejoin."

ROLLBACK_DIR="$(cd "${SCRIPT_DIR}/../rollbacks" && pwd)"

run_psql -f "${SCRIPT_DIR}/00_bootstrap_supabase_stubs.sql"

apply_migrations() {
  local pass="$1"
  for migration in "${MIGRATIONS_DIR}"/*.sql; do
    echo "Applying pass ${pass}: $(basename "${migration}")"
    run_psql -f "${migration}"
  done
}

apply_migrations 1
apply_migrations 2
echo "MIGRATION_TWICE_OK"
run_psql -f "${SCRIPT_DIR}/14_definition_order.sql"

run_psql -f "${SCRIPT_DIR}/10_privileges_reveal_asserts.sql"
run_psql -f "${SCRIPT_DIR}/11_attendance_flow_asserts.sql"
bash "${SCRIPT_DIR}/12_like_race.sh"
run_psql -f "${SCRIPT_DIR}/13_product_flow.sql"
run_psql -f "${SCRIPT_DIR}/17_profile_upsert_and_mark_attendance.sql"
run_psql -f "${SCRIPT_DIR}/25_profile_save_statement.sql"
run_psql -f "${SCRIPT_DIR}/19_seat_holds.sql"
run_psql -f "${SCRIPT_DIR}/20_age_bands.sql"
run_psql -f "${SCRIPT_DIR}/29_three_age_bands.sql"
run_psql -f "${SCRIPT_DIR}/26_gym_owner_classes.sql"
run_psql -f "${SCRIPT_DIR}/26_profile_photo_storage.sql"
run_psql -f "${SCRIPT_DIR}/27_owner_announcements.sql"
run_psql -f "${SCRIPT_DIR}/28_consent_and_account_deletion.sql"
run_psql -f "${SCRIPT_DIR}/30_anon_security_definer_execute.sql"
run_psql -f "${SCRIPT_DIR}/31_match_messages.sql"
run_psql -f "${SCRIPT_DIR}/32_match_chat_safety.sql"
echo "SQL_TESTS_OK"

echo "Announcement rollback keeps profile photo functions and grants"
photo_acl() {
  run_psql -tA -c "select n.nspname || '.' || p.proname || '(' || pg_catalog.pg_get_function_identity_arguments(p.oid) || ') acl=' || coalesce(p.proacl::text, 'null') || ' exec_auth=' || has_function_privilege('authenticated', p.oid, 'EXECUTE') || ' exec_anon=' || has_function_privilege('anon', p.oid, 'EXECUTE') from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private' and p.proname in ('profile_photo_owner_id', 'can_read_profile_photo') order by p.proname;"
}
photo_before="$(photo_acl)"
if [[ -z "${photo_before}" ]]; then
  echo "profile photo functions were missing before the announcement rollback" >&2
  exit 1
fi
run_psql -f "${ROLLBACK_DIR}/20261113_owner_announcements_rollback.sql"
photo_after="$(photo_acl)"
if [[ "${photo_before}" != "${photo_after}" ]]; then
  echo "announcement rollback changed profile photo function grants" >&2
  echo "before: ${photo_before}" >&2
  echo "after: ${photo_after}" >&2
  exit 1
fi
run_psql -c "select to_regprocedure('private.profile_photo_owner_id(text)'), to_regprocedure('private.can_read_profile_photo(uuid)');" >/dev/null
echo "PHOTO_FUNCTIONS_KEPT"
run_psql -f "${MIGRATIONS_DIR}/20261113_owner_announcements.sql"
photo_reapplied="$(photo_acl)"
if [[ "${photo_before}" != "${photo_reapplied}" ]]; then
  echo "re-applying announcements changed profile photo function grants" >&2
  echo "before: ${photo_before}" >&2
  echo "after: ${photo_reapplied}" >&2
  exit 1
fi
echo "PHOTO_GRANTS_UNCHANGED"

echo "Consent rollback keeps profile photo functions and grants"
photo_before_consent="$(photo_acl)"
run_psql -f "${ROLLBACK_DIR}/20261114_consent_and_account_deletion_rollback.sql"
photo_after_consent="$(photo_acl)"
if [[ "${photo_before_consent}" != "${photo_after_consent}" ]]; then
  echo "consent rollback changed profile photo function grants" >&2
  echo "before: ${photo_before_consent}" >&2
  echo "after: ${photo_after_consent}" >&2
  exit 1
fi
if ! run_psql -tAc "select to_regprocedure('private.profile_photo_owner_id(text)') is not null and to_regprocedure('private.can_read_profile_photo(uuid)') is not null and to_regprocedure('private.is_approved_gym_owner()') is not null;" | grep -q t; then
  echo "consent rollback removed a private photo or announcement function" >&2
  exit 1
fi
run_psql -f "${MIGRATIONS_DIR}/20261114_consent_and_account_deletion.sql"
photo_consent_reapplied="$(photo_acl)"
if [[ "${photo_before_consent}" != "${photo_consent_reapplied}" ]]; then
  echo "re-applying consent changed profile photo function grants" >&2
  exit 1
fi
echo "CONSENT_ROLLBACK_KEPT_PHOTO_FUNCTIONS"

echo "Photo age-gate rollback restores the main definition and keeps grants"
photo_security() {
  run_psql -tA -c "select p.prosecdef::text || '|' || p.provolatile::text || '|' || coalesce(p.proconfig::text, '') || '|' || p.proowner::text || '|' || pg_catalog.pg_get_function_identity_arguments(p.oid) || '|' || pg_catalog.pg_get_function_result(p.oid) from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private' and p.proname = 'can_read_profile_photo';"
}
photo_src_has_age() {
  run_psql -tAc "select position('age_preferences_allow' in p.prosrc) > 0 and position('age_preference' in p.prosrc) > 0 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private' and p.proname = 'can_read_profile_photo';"
}
photo_acl_before_age="$(photo_acl)"
photo_security_before_age="$(photo_security)"
if [[ "$(photo_src_has_age)" != "f" ]]; then
  echo "can_read_profile_photo still applies the age gate" >&2
  exit 1
fi
run_psql -f "${ROLLBACK_DIR}/20261115_profile_photo_without_age_gate_rollback.sql"
if [[ "$(photo_src_has_age)" != "t" ]]; then
  echo "photo rollback did not restore the age gate" >&2
  exit 1
fi
if ! run_psql -tAc "select position('attendance_status' in p.prosrc) > 0 and position('class_scheduled_end' in p.prosrc) > 0 and position('public.is_admin' in p.prosrc) > 0 and p.prosecdef and coalesce(p.proconfig::text, '') like '%search_path%' from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private' and p.proname = 'can_read_profile_photo';" | grep -q t; then
  echo "photo rollback did not restore the main attendance and security definition" >&2
  exit 1
fi
photo_acl_after_age="$(photo_acl)"
photo_security_after_age="$(photo_security)"
if [[ "${photo_acl_before_age}" != "${photo_acl_after_age}" || "${photo_security_before_age}" != "${photo_security_after_age}" ]]; then
  echo "photo rollback changed grants or security" >&2
  echo "acl before: ${photo_acl_before_age}" >&2
  echo "acl after: ${photo_acl_after_age}" >&2
  echo "security before: ${photo_security_before_age}" >&2
  echo "security after: ${photo_security_after_age}" >&2
  exit 1
fi
run_psql -f "${MIGRATIONS_DIR}/20261115_profile_photo_without_age_gate.sql"
if [[ "$(photo_src_has_age)" != "f" ]]; then
  echo "re-applying the photo migration left the age gate in place" >&2
  exit 1
fi
photo_acl_reapplied="$(photo_acl)"
photo_security_reapplied="$(photo_security)"
if [[ "${photo_acl_before_age}" != "${photo_acl_reapplied}" || "${photo_security_before_age}" != "${photo_security_reapplied}" ]]; then
  echo "re-applying the photo migration changed grants or security" >&2
  exit 1
fi
echo "PHOTO_AGE_GATE_ROLLBACK_OK"

echo "Execute-grant rollback restores anon and the previous search_path"
run_psql -f "${ROLLBACK_DIR}/20261122_revoke_anon_security_definer_execute_rollback.sql"
run_psql -f "${SCRIPT_DIR}/30_execute_rollback_asserts.sql"
run_psql -f "${MIGRATIONS_DIR}/20261122_revoke_anon_security_definer_execute.sql"
run_psql -f "${SCRIPT_DIR}/30_execute_grants_asserts.sql"
echo "EXECUTE_GRANT_ROLLBACK_OK"

echo "Match chat safety rollback drops only block/report objects and keeps match messages"
run_psql -f "${ROLLBACK_DIR}/20261125_match_chat_safety_rollback.sql"
if ! run_psql -tAc "select to_regclass('public.match_chat_blocks') is null and to_regclass('public.match_chat_reports') is null and to_regprocedure('private.block_match_chat(uuid)') is null and to_regprocedure('public.report_match_chat(uuid,text,text,uuid)') is null and to_regclass('public.match_messages') is not null and to_regprocedure('public.send_match_message(uuid,text)') is not null;" | grep -q t; then
  echo "match chat safety rollback left safety objects or removed match_messages" >&2
  exit 1
fi
run_psql -f "${SCRIPT_DIR}/31_match_messages.sql"
echo "MATCH_CHAT_SAFETY_ROLLBACK_OK"

echo "Match message rollback drops only the message objects"
run_psql -f "${ROLLBACK_DIR}/20261124_match_messages_rollback.sql"
if ! run_psql -tAc "select to_regclass('public.match_messages') is null and to_regprocedure('private.can_use_match_chat(uuid)') is null and to_regprocedure('public.send_match_message(uuid,text)') is null and to_regclass('public.matches') is not null and to_regprocedure('private.is_approved_gym_owner()') is not null;" | grep -q t; then
  echo "match message rollback left message objects or removed other objects" >&2
  exit 1
fi
run_psql -f "${MIGRATIONS_DIR}/20261124_match_messages.sql"
run_psql -f "${SCRIPT_DIR}/31_match_messages.sql"
run_psql -f "${MIGRATIONS_DIR}/20261125_match_chat_safety.sql"
run_psql -f "${SCRIPT_DIR}/32_match_chat_safety.sql"
echo "MATCH_MESSAGES_ROLLBACK_OK"

echo "Rolling migrations back, newest first"
for rollback in \
  20261125_match_chat_safety_rollback.sql \
  20261124_match_messages_rollback.sql \
  20261122_revoke_anon_security_definer_execute_rollback.sql \
  20261121_three_age_bands_rollback.sql \
  20261115_profile_photo_without_age_gate_rollback.sql \
  20261114_consent_and_account_deletion_rollback.sql \
  20261113_owner_announcements_rollback.sql \
  20261112_profile_photo_storage_rollback.sql \
  20261112_gym_owner_classes_rollback.sql \
  20261110110649_ignore_age_preference_rollback.sql \
  20261108_age_bands_rollback.sql \
  20261107_class_seat_holds_rollback.sql \
  20261106_revoke_participant_client_writes_rollback.sql \
  20261104_record_attendance_rollback.sql \
  20261102_attendance_reveal_rollback.sql \
  20261030_profiles_is_admin_privileges_rollback.sql \
  20260914_sweating_sprint02_rollback.sql \
  20260905_sweating_v0_rollback.sql
do
  echo "Rollback ${rollback}"
  run_psql -f "${ROLLBACK_DIR}/${rollback}"
done
run_psql -f "${SCRIPT_DIR}/15_after_rollback.sql"
echo "ROLLBACK_OK"

echo "Re-applying migrations after rollback"
apply_migrations 3
run_psql -f "${SCRIPT_DIR}/16_after_reapply.sql"
run_psql -f "${SCRIPT_DIR}/29_three_age_bands.sql"
run_psql -f "${SCRIPT_DIR}/19_seat_holds.sql"
run_psql -f "${SCRIPT_DIR}/26_profile_photo_storage.sql"
run_psql -f "${SCRIPT_DIR}/28_consent_and_account_deletion.sql"
run_psql -f "${SCRIPT_DIR}/31_match_messages.sql"
run_psql -f "${SCRIPT_DIR}/32_match_chat_safety.sql"
echo "ROLLBACK_REAPPLY_OK"

# Second database: the catalog baseline, then 20261030 / 20261102 / 20261104.
# Never points at a Supabase host.
baseline_db="${PGDATABASE}_baseline"
echo "Preparing ${baseline_db}"
if [[ "${USE_SUDO_POSTGRES:-}" == "1" ]]; then
  sudo -u postgres psql -v ON_ERROR_STOP=1 -d postgres \
    -c "drop database if exists ${baseline_db};" \
    -c "create database ${baseline_db};"
else
  psql -v ON_ERROR_STOP=1 -d postgres \
    -c "drop database if exists ${baseline_db};" \
    -c "create database ${baseline_db};"
fi
PGDATABASE="${baseline_db}" bash "${SCRIPT_DIR}/run-prod-baseline.sh"
if [[ "${USE_SUDO_POSTGRES:-}" == "1" ]]; then
  sudo -u postgres psql -v ON_ERROR_STOP=1 -d postgres \
    -c "drop database if exists ${baseline_db};"
else
  psql -v ON_ERROR_STOP=1 -d postgres \
    -c "drop database if exists ${baseline_db};"
fi
