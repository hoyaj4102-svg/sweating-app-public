import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("start choice screen links returning users to the existing login page", () => {
  const source = readFileSync(new URL("./StartPage.tsx", import.meta.url), "utf8");
  assert.match(source, /data-testid="link-start-login"/);
  assert.match(source, /href="\/login"/);
  assert.match(source, />이미 계정이 있으신가요\? 로그인</);
  assert.doesNotMatch(source, /이미 계정이 있나요\?/);
  assert.match(source, /href=\{withCampaign\("\/signup", search\)\}/);
  assert.match(source, /href=\{withCampaign\("\/partners", search\)\}/);
});
