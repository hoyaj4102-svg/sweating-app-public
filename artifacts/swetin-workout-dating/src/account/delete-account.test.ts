import assert from "node:assert/strict";
import test from "node:test";
import { DELETE_CONFIRMATION, deletionConfirmed } from "./delete-account.ts";

test("account deletion asks for the confirmation phrase before it is ready", () => {
  assert.equal(deletionConfirmed(""), false);
  assert.equal(deletionConfirmed("탈퇴합니다"), false);
  assert.equal(deletionConfirmed(` ${DELETE_CONFIRMATION}`), false);
  assert.equal(deletionConfirmed(DELETE_CONFIRMATION), true);
});
