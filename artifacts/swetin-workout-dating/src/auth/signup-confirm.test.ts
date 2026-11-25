import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const CHECK_EMAIL = "메일을 확인해 주세요. 인증 메일이 도착하면, 인증을 마친 뒤 로그인해 주세요.";
const OLD_SUCCESS = "가입은 완료됐어요. 이메일 인증을 마친 뒤 로그인해 주세요.";
const FAILURE = "가입을 완료하지 못했어요. 이메일 주소를 확인하거나 잠시 후 다시 시도해 주세요.";
const RATE_LIMIT = "가입 요청이 많아요. 잠시 후 다시 시도해 주세요.";
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function authScreen(): { source: string; screen: string } {
  const source = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  return { source, screen: source.slice(source.indexOf("function AuthScreen"), source.indexOf("function ProfileScreen")) };
}

test("session-less signup shows the shared check-email copy, not the signup failure remap", () => {
  const { source, screen } = authScreen();
  assert.match(source, new RegExp(`const SIGNUP_CHECK_EMAIL = "${escape(CHECK_EMAIL)}";`));
  assert.match(screen, /setNotice\(SIGNUP_CHECK_EMAIL\)/);
  assert.match(screen, /data-testid="status-signup-check-email"/);
  assert.equal(screen.includes("status-signup-confirm"), false);
  assert.match(screen, new RegExp(escape(FAILURE)));
  const noticeAt = screen.indexOf("setNotice(SIGNUP_CHECK_EMAIL)");
  const failureAt = screen.indexOf(FAILURE);
  assert.ok(noticeAt > 0 && failureAt > noticeAt);
  assert.equal(screen.includes("setError(SIGNUP_CHECK_EMAIL)"), false);
  // Exactly one notice path: the same copy whether the address is new or already registered.
  assert.equal(screen.match(/setNotice\(/g)?.length, 2); // setNotice("") reset + the check-email copy
  assert.match(screen, /setNotice\(""\)/);
});

test("the check-email copy does not claim signup finished or say whether the address exists", () => {
  const { source } = authScreen();
  assert.equal(source.includes(OLD_SUCCESS), false);
  for (const word of ["완료됐", "완료되었", "가입됐", "가입되었", "이미", "가입된"]) {
    assert.equal(CHECK_EMAIL.includes(word), false, word);
  }
});

test("signup failures keep their own messages", () => {
  const { screen } = authScreen();
  // 400/422 from the API arrive as the generic signup failure and are remapped to FAILURE.
  assert.match(screen, /message === "회원가입에 실패했습니다\. 입력한 정보를 확인해 주세요\."/);
  // A 429 message is passed through unchanged (it is not the remapped text).
  assert.equal(screen.includes(RATE_LIMIT), false);
  assert.match(screen, /: message\);/);
  const api = readFileSync(new URL("../../../api-server/src/routes/auth.ts", import.meta.url), "utf8");
  assert.ok(api.includes(RATE_LIMIT));
  assert.equal(api.includes(CHECK_EMAIL), false);
});
