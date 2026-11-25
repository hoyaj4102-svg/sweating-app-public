import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import test from "node:test";

const exec = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const database = `sweating_sql_${process.pid}`;

async function sudoPostgres(args) {
  await exec("sudo", ["-u", "postgres", ...args]);
}

test("local Postgres applies migrations and enforces is_admin and reveal", async (t) => {
  try {
    await access("/var/run/postgresql/.s.PGSQL.5432");
  } catch {
    t.skip("local Postgres socket is absent; sql-privileges-reveal runs this script");
    return;
  }
  await sudoPostgres(["dropdb", "--if-exists", database]);
  await sudoPostgres(["createdb", database]);
  try {
    const { stdout, stderr } = await exec("bash", ["artifacts/api-server/supabase/tests/run-sql-tests.sh"], {
      env: {
        ...process.env,
        PGDATABASE: database,
        USE_SUDO_POSTGRES: "1",
        PGHOST: "",
      },
      cwd: repoRoot,
    });
    const output = `${stdout}\n${stderr}`;
    assert.match(output, /PASS: authenticated cannot update own is_admin/);
    assert.match(output, /PASS: authenticated cannot update another user is_admin/);
    assert.match(output, /PASS: RLS hides other users private profile fields/);
    assert.match(output, /PASS: reveal stays closed before the scheduled end/);
    assert.match(output, /PASS: after the scheduled end only attended participants are revealed/);
    assert.match(output, /MIGRATION_ORDER_OK/);
    assert.match(
      output,
      /20260905_sweating_v0\.sql 20260914_sweating_sprint02\.sql 20261030_profiles_is_admin_privileges\.sql 20261102_attendance_reveal\.sql 20261104_record_attendance\.sql 20261106_revoke_participant_client_writes\.sql 20261107_class_seat_holds\.sql 20261108_age_bands\.sql 20261110110649_ignore_age_preference\.sql 20261112_gym_owner_classes\.sql 20261112_profile_photo_storage\.sql 20261113_owner_announcements\.sql 20261114_consent_and_account_deletion\.sql 20261115_profile_photo_without_age_gate\.sql 20261121_three_age_bands\.sql 20261122_revoke_anon_security_definer_execute\.sql 20261124_match_messages\.sql 20261125_match_chat_safety\.sql/,
    );
    assert.match(output, /PASS: participant cannot record own attendance/);
    assert.match(output, /PASS: non-admin cannot record another participant/);
    assert.match(output, /PASS: direct attendance update is rejected/);
    assert.match(output, /PASS: attendance is refused before the class starts/);
    assert.match(output, /PASS: attendance is refused after the 24 hour window/);
    assert.match(output, /PASS: attendance then class end then reveal shows only attended/);
    assert.match(output, /PASS: no_show is excluded from reveal and cannot like/);
    assert.match(output, /PASS: mutual like creates exactly one match/);
    assert.match(output, /PASS: attendance is locked after a like/);
    assert.match(output, /ATTENDANCE_FLOW_OK/);
    assert.match(output, /LIKE_RACE_OK/);
    assert.match(output, /MIGRATION_TWICE_OK/);
    assert.match(output, /PRODUCT_FLOW_OK/);
    assert.match(output, /SQL_TESTS_OK/);
    assert.match(output, /PASS: a matched pair can send and read/);
    assert.match(output, /PASS: a non-member cannot read or send/);
    assert.match(output, /PASS: anon is denied/);
    assert.match(output, /PASS: an unmatched pair is denied/);
    assert.match(output, /PASS: message length limit/);
    assert.match(output, /PASS: a pair whose attendance was reversed is blocked/);
    assert.match(output, /MATCH_MESSAGES_OK/);
    assert.match(output, /MATCH_MESSAGES_ROLLBACK_OK/);
    assert.match(output, /PASS: blocked sender cannot send and unblock restores sending/);
    assert.match(output, /PASS: third party cannot see blocks or touch the conversation/);
    assert.match(output, /PASS: reports are visible only to admins and never to reported user or non-admins/);
    assert.match(output, /PASS: send rate limits trigger per minute and per day/);
    assert.match(output, /MATCH_CHAT_SAFETY_OK/);
    assert.match(output, /MATCH_CHAT_SAFETY_ROLLBACK_OK/);
    assert.match(output, /SEAT_HOLDS_OK/);
    assert.match(output, /PASS: profile photo bucket is private and limited/);
    assert.match(output, /PASS: owner can insert and update only their own avatar/);
    assert.match(output, /PASS: revealed peer can read and cannot write/);
    assert.match(output, /PASS: non-revealed peers cannot read/);
    assert.match(output, /PASS: anonymous role cannot read or write profile photos/);
    assert.match(output, /PASS: admin can read and cannot delete another photo/);
    assert.match(output, /PASS: owner can delete their own photo/);
    assert.match(output, /PROFILE_PHOTO_STORAGE_OK/);
    assert.match(output, /ROLLBACK_OK/);
    assert.match(output, /ROLLBACK_REAPPLY_OK/);
    assert.match(output, /PROD_MARK_BEFORE_OK/);
    assert.match(output, /PROFILE_UPSERT_OK/);
    assert.match(output, /PASS: authenticated profile insert writes own id and leaves is_admin false/);
    assert.match(output, /PASS: authenticated profile update changes editable columns only/);
    assert.match(output, /PASS: authenticated profile save cannot change id/);
    assert.match(output, /PASS: authenticated profile save cannot change is_admin/);
    assert.match(output, /PASS: authenticated profile save cannot change another user/);
    assert.match(output, /PROFILE_SAVE_OK/);
    assert.match(output, /MARK_ATTENDANCE_OK/);
    assert.match(output, /PASS: cross-gym class and participant access is denied/);
    assert.match(output, /PASS: gym owner class boundaries hold/);
    assert.match(output, /APPLY_ORDER 20261030 20261102 20261104 20261106 20261107 20261108 20261110 20261112 20261113 20261121/);
    assert.match(output, /BASELINE_ROLLBACK_OK/);
    assert.match(output, /REAPPLY_ORDER 20261030 20261102 20261104 20261106 20261107 20261108 20261110 20261112 20261113 20261121/);
    assert.match(output, /PASS age bands: a 46\+ pair can reveal, like, and match/);
    assert.match(output, /THREE_AGE_BANDS_OK/);
    assert.match(output, /PASS: attended peers outside the recruiting band can read/);
    assert.match(output, /PHOTO_AGE_GATE_ROLLBACK_OK/);
    assert.match(output, /PASS: anon and public cannot execute is_admin or enforce_like_participants/);
    assert.match(output, /PASS: anon cannot call is_admin or the like trigger/);
    assert.match(output, /PASS: anon still reads published classes and not drafts/);
    assert.match(output, /PASS: signed-in admin detection and draft read still use is_admin\(\)/);
    assert.match(output, /PASS: signed-in likes still match and the trigger still fires/);
    assert.match(output, /PASS: anon and signed-in clients still cannot insert likes directly/);
    assert.match(output, /ANON_SECURITY_DEFINER_EXECUTE_OK/);
    assert.match(output, /PASS: execute rollback restores anon and keeps public revoked/);
    assert.match(output, /EXECUTE_GRANT_ROLLBACK_OK/);
    assert.match(output, /PROD_BASELINE_OK/);
    assert.doesNotMatch(output, /supabase\.co/);
  } finally {
    await sudoPostgres(["dropdb", "--if-exists", database]);
  }
});
