#!/usr/bin/env bash
# Apply repo migrations to a throwaway Postgres and assert admin authorization.
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

if [[ ! "${PGDATABASE}" =~ ^[A-Za-z0-9_]+$ ]]; then
  echo "PGDATABASE must be a simple identifier." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATIONS_DIR="$(cd "${SCRIPT_DIR}/../migrations" && pwd)"

run_psql() {
  psql -v ON_ERROR_STOP=1 -X "$@"
}

echo "Admin authz SQL database: ${PGDATABASE} host=${PGHOST:-local}"
run_psql -tAc "select current_setting('server_version');"

run_psql -f "${SCRIPT_DIR}/00_admin_authz_bootstrap.sql"
run_psql -f "${MIGRATIONS_DIR}/20260905_sweating_v0.sql"
run_psql -f "${MIGRATIONS_DIR}/20260914_sweating_sprint02.sql"
run_psql -f "${SCRIPT_DIR}/21_before_client_writes.sql"

run_psql -f "${MIGRATIONS_DIR}/20261106_revoke_participant_client_writes.sql"
run_psql -f "${MIGRATIONS_DIR}/20261106_revoke_participant_client_writes.sql"
run_psql -f "${SCRIPT_DIR}/22_after_admin_authz.sql"
echo "ADMIN_AUTHZ_SQL_OK"
