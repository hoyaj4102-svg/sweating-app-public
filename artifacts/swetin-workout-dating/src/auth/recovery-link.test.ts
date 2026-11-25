import assert from "node:assert/strict";
import test from "node:test";
import { clearRecoveryLink, currentRecoveryLink, parseRecoveryLink, recoveryUrlWithoutSecrets, rememberRecoveryLink } from "./recovery-link.ts";
import { isUserFacingMessage } from "./user-message.ts";
import { PASSWORD_POLICY_MESSAGES } from "@workspace/password-policy";

const TOKEN = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.signature";

test("a recovery hash keeps the access token and ignores other auth types", () => {
  const ready = parseRecoveryLink(`#access_token=${TOKEN}&refresh_token=refresh&type=recovery`, "");
  assert.deepEqual(ready, { kind: "ready", accessToken: TOKEN });
  assert.equal(parseRecoveryLink(`#access_token=${TOKEN}&type=signup`, "").kind, "absent");
  assert.equal(parseRecoveryLink("#section", "?next=/classes/x").kind, "absent");
  assert.equal(parseRecoveryLink("", "").kind, "absent");
});

test("expired recovery links are invalid in the hash or the query", () => {
  assert.equal(parseRecoveryLink("#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired", "").kind, "invalid");
  assert.equal(parseRecoveryLink("", "?error=access_denied&error_code=otp_expired").kind, "invalid");
  assert.equal(parseRecoveryLink("", "?error=access_denied").kind, "absent");
  assert.equal(parseRecoveryLink("#type=recovery", "").kind, "invalid");
  assert.equal(parseRecoveryLink(`#type=recovery&access_token=${"a".repeat(30)}`, "").kind, "invalid");
});

test("a query recovery token is accepted and then removed from the url", () => {
  assert.deepEqual(parseRecoveryLink("", `?type=recovery&access_token=${TOKEN}&next=/home`), {
    kind: "ready",
    accessToken: TOKEN,
  });
  const stripped = recoveryUrlWithoutSecrets(`/reset-password?type=recovery&access_token=${TOKEN}&refresh_token=refresh&next=/home#keep`);
  const strippedUrl = new URL(stripped, "http://localhost");
  assert.equal(strippedUrl.pathname, "/reset-password");
  assert.equal(strippedUrl.searchParams.get("next"), "/home");
  assert.equal(strippedUrl.searchParams.get("access_token"), null);
  assert.equal(strippedUrl.searchParams.get("type"), null);
  assert.equal(strippedUrl.hash, "#keep");
  assert.equal(
    recoveryUrlWithoutSecrets(`https://app.example.com/#access_token=${TOKEN}&type=recovery&error_code=otp_expired`),
    "https://app.example.com/",
  );
  assert.equal(recoveryUrlWithoutSecrets("/login?oauth_error=hello#section"), "/login?oauth_error=hello#section");
});

test("recovery copy stays inside the login error filter", () => {
  for (const message of [
    "메일을 확인해 주세요. 가입된 주소라면 재설정 링크가 도착해요.",
    "이메일 주소를 확인해 주세요.",
    "재설정 메일을 보내지 못했어요. 잠시 후 다시 시도해 주세요.",
    "재설정 링크가 만료됐거나 올바르지 않아요. 로그인 화면에서 다시 요청해 주세요.",
    ...Object.values(PASSWORD_POLICY_MESSAGES),
    "지금 쓰는 비밀번호와 다른 비밀번호로 정해 주세요.",
    "더 안전한 비밀번호로 정해 주세요.",
    "비밀번호를 바꾸지 못했어요. 잠시 후 다시 시도해 주세요.",
    "비밀번호를 바꿨어요. 새 비밀번호로 로그인해 주세요.",
    "비밀번호를 바꿨어요.",
  ]) {
    assert.equal(isUserFacingMessage(message), true, message);
  }
  assert.equal(isUserFacingMessage("Invalid login credentials"), false);
  assert.equal(isUserFacingMessage(""), false);
});

test("remembered recovery survives after the url is cleared", () => {
  clearRecoveryLink();
  assert.equal(currentRecoveryLink().kind, "absent");
  rememberRecoveryLink({ kind: "ready", accessToken: TOKEN });
  assert.deepEqual(currentRecoveryLink(), { kind: "ready", accessToken: TOKEN });
  clearRecoveryLink();
  assert.equal(currentRecoveryLink().kind, "absent");
});
