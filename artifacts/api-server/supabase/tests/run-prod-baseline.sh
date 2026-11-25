#!/usr/bin/env bash
# Catalog baseline, then 20261030, 20261102, 20261104, 20261106, 20261107,
# 20261108, 20261110110649, the local-only 20261112 gym owner migration, the
# local-only 20261113 owner announcements migration, and the local-only
# 20261121 three-band migration.
# 20261110110649, 20261112, 20261113, and 20261121 are not applied to a hosted database by this script.
# The baseline already matches production after the 2026-11-04 08:12 KST
# class_participants revoke: anon and authenticated have SELECT only.
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
ROLLBACK_DIR="$(cd "${SCRIPT_DIR}/../rollbacks" && pwd)"

run_psql() {
  if [[ "${USE_SUDO_POSTGRES:-}" == "1" ]]; then
    sudo -u postgres psql -v ON_ERROR_STOP=1 -X -d "${PGDATABASE}" "$@"
  else
    psql -v ON_ERROR_STOP=1 -X "$@"
  fi
}

echo "Prod baseline database: ${PGDATABASE} host=${PGHOST:-local}"
run_psql -tAc "select current_setting('server_version');"

run_psql -f "${SCRIPT_DIR}/00_bootstrap_supabase_stubs.sql"
run_psql -f "${SCRIPT_DIR}/01_prod_baseline.sql"
run_psql -f "${SCRIPT_DIR}/18_prod_mark_attendance_before.sql"

apply_catalog_migrations() {
  local pass="$1"
  local migration
  for migration in \
    20261030_profiles_is_admin_privileges.sql \
    20261102_attendance_reveal.sql \
    20261104_record_attendance.sql \
    20261106_revoke_participant_client_writes.sql \
    20261107_class_seat_holds.sql \
    20261108_age_bands.sql \
    20261110110649_ignore_age_preference.sql \
    20261112_gym_owner_classes.sql \
    20261113_owner_announcements.sql \
    20261121_three_age_bands.sql
  do
    echo "Baseline pass ${pass}: ${migration}"
    run_psql -f "${MIGRATIONS_DIR}/${migration}"
  done
}

echo "APPLY_ORDER 20261030 20261102 20261104 20261106 20261107 20261108 20261110 20261112 20261113 20261121"
apply_catalog_migrations 1
apply_catalog_migrations 2

echo "ROLLBACK_ORDER 20261121 20261113 20261112 20261110 20261108 20261107 20261106 20261104 20261102 20261030"
for rollback in \
  20261121_three_age_bands_rollback.sql \
  20261113_owner_announcements_rollback.sql \
  20261112_gym_owner_classes_rollback.sql \
  20261110110649_ignore_age_preference_rollback.sql \
  20261108_age_bands_rollback.sql \
  20261107_class_seat_holds_rollback.sql \
  20261106_revoke_participant_client_writes_rollback.sql \
  20261104_record_attendance_rollback.sql \
  20261102_attendance_reveal_rollback.sql \
  20261030_profiles_is_admin_privileges_rollback.sql
do
  echo "Baseline rollback ${rollback}"
  run_psql -f "${ROLLBACK_DIR}/${rollback}"
done
run_psql -f "${SCRIPT_DIR}/24_after_catalog_rollback.sql"
echo "BASELINE_ROLLBACK_OK"

echo "REAPPLY_ORDER 20261030 20261102 20261104 20261106 20261107 20261108 20261110 20261112 20261113 20261121"
apply_catalog_migrations 3

run_psql -f "${SCRIPT_DIR}/14_definition_order.sql"
run_psql -f "${SCRIPT_DIR}/17_profile_upsert_and_mark_attendance.sql"
run_psql -f "${SCRIPT_DIR}/25_profile_save_statement.sql"
run_psql -f "${SCRIPT_DIR}/13_product_flow.sql"
run_psql -f "${SCRIPT_DIR}/19_seat_holds.sql"
run_psql -f "${SCRIPT_DIR}/20_age_bands.sql"
echo "PROD_BASELINE_OK"
