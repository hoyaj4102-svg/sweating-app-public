import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  COMMON_PASSWORD_COUNT,
  PASSWORD_POLICY_MESSAGES,
  validateNewPassword,
} from "../src/index.ts";

const dir = path.dirname(fileURLToPath(import.meta.url));
const list = readFileSync(path.join(dir, "../src/common-passwords.txt"), "utf8")
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean);

test("the bundled list has about 1000 unique lowercase passwords", () => {
  assert.equal(new Set(list).size, list.length);
  assert.equal(COMMON_PASSWORD_COUNT, list.length);
  assert.ok(list.length >= 1000 && list.length <= 1200, String(list.length));
  assert.equal(list.includes("password"), true);
  assert.equal(list.includes("1q2w3e4r5t"), true);
  assert.equal(list.includes("비밀번호"), true);
});

test("new passwords must be 10+ characters with a letter and a number", () => {
  assert.equal(validateNewPassword("short").ok === false && validateNewPassword("short").reason, "too_short");
  assert.equal(validateNewPassword("abcdefghij").ok === false && (validateNewPassword("abcdefghij") as { reason: string }).reason, "need_letter_and_number");
  assert.equal((validateNewPassword("1234567890") as { reason: string }).reason, "need_letter_and_number");
  assert.equal((validateNewPassword("가나다라마바사아자차") as { reason: string }).reason, "need_letter_and_number");
  assert.equal((validateNewPassword("a".repeat(201)) as { reason: string }).reason, "too_long");
  assert.equal(validateNewPassword("우리동네노란가방17").ok, true);
  assert.equal(validateNewPassword("lakehouse42").ok, true);
  assert.equal(validateNewPassword("password12").ok, true);
});

test("very common passwords and the email local-part are rejected", () => {
  assert.equal((validateNewPassword("1q2w3e4r5t") as { reason: string }).reason, "too_common");
  assert.equal((validateNewPassword("1Q2W3E4R5T") as { reason: string }).reason, "too_common");
  assert.equal((validateNewPassword("minsu.kim99", { email: "Minsu.Kim@example.com" }) as { reason: string }).reason, "contains_email");
  assert.equal(validateNewPassword("ab12345678", { email: "ab@example.com" }).ok, true);
  assert.equal(validateNewPassword("abc123").ok, false);
});

test("user-facing messages stay in Korean without Latin letters", () => {
  const allowed = /^[가-힣0-9\s.,!?~…·’'()\-]+$/;
  for (const message of Object.values(PASSWORD_POLICY_MESSAGES)) {
    assert.equal(allowed.test(message), true, message);
    assert.ok(message.length > 0 && message.length <= 160);
  }
});
