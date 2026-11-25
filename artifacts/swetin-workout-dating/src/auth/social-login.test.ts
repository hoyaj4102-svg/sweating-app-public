import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { oauthErrorFromSearch, socialLoginButtons } from "./social-login.ts";

test("Kakao and Google buttons start the existing API OAuth routes", () => {
  assert.deepEqual(
    socialLoginButtons.map((provider) => [provider.id, provider.startPath, provider.testId]),
    [
      ["kakao", "/api/auth/kakao/start", "button-kakao-login"],
      ["google", "/api/auth/google/start", "button-google-login"],
    ],
  );
  assert.equal(socialLoginButtons[0]?.label, "카카오로 시작하기");
  assert.equal(socialLoginButtons[1]?.label, "Google 계정으로 시작하기");
});

test("login and signup share the social buttons with no hide flag", () => {
  const source = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  const screen = source.slice(source.indexOf("function AuthScreen"), source.indexOf("function ProfileScreen"));
  assert.ok(screen.includes("function AuthScreen"));
  assert.match(screen, /socialLoginButtons\.map/);
  assert.doesNotMatch(screen, /SOCIAL_LOGIN_ENABLED/);
  assert.doesNotMatch(screen, /mode === "login"[\s\S]{0,80}socialLoginButtons/);
});

test("OAuth callback errors stay on the login screen as safe Korean copy", () => {
  assert.equal(
    oauthErrorFromSearch("?oauth_error=" + encodeURIComponent("카카오 로그인을 취소했어요.")),
    "카카오 로그인을 취소했어요.",
  );
  assert.equal(
    oauthErrorFromSearch("?oauth_error=" + encodeURIComponent("Google 로그인에 실패했어요. 잠시 후 다시 시도해 주세요.")),
    "Google 로그인에 실패했어요. 잠시 후 다시 시도해 주세요.",
  );
  assert.equal(oauthErrorFromSearch(""), "");
  assert.equal(oauthErrorFromSearch("?next=/home"), "");
  assert.equal(
    oauthErrorFromSearch("?oauth_error=" + encodeURIComponent("<script>alert(1)</script>")),
    "소셜 로그인에 실패했어요. 잠시 후 다시 시도해 주세요.",
  );
  assert.equal(
    oauthErrorFromSearch("?oauth_error=" + encodeURIComponent("https://evil.test/phish")),
    "소셜 로그인에 실패했어요. 잠시 후 다시 시도해 주세요.",
  );
});
