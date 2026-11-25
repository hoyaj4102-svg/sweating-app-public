import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./spawn-vercel-handler.mjs", import.meta.url));

function detail(result, secret) {
  const text = `${result.stderr ?? ""}\n${result.stdout ?? ""}`;
  return secret ? text.replaceAll(secret, "[redacted]") : text;
}

function run(extra, requestPath) {
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    NODE_ENV: "production",
    LOG_LEVEL: "silent",
    HANDLER_PATH: requestPath,
    SUPABASE_URL: "https://example.test",
    SUPABASE_ANON_KEY: "test-anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
    ...extra,
  };
  return spawnSync(process.execPath, [script], { env, encoding: "utf8", timeout: 15000 });
}

test("bundled Vercel handler loads without a signing key and refuses work", () => {
  const result = run({}, "/api/healthz");
  assert.equal(result.status, 0, detail(result));
  assert.equal(result.stdout, "503");
});

test("bundled Vercel handler serves health and prefixed /api routes when configured", () => {
  const secret = randomBytes(48).toString("base64url");
  const health = run({ SESSION_SECRET: secret }, "/api/healthz");
  assert.equal(health.status, 0, detail(health, secret));
  assert.equal(health.stdout, "200");
  assert.equal(health.stderr.includes(secret), false);

  const auth = run({ SESSION_SECRET: secret }, "/auth/me?x=1");
  assert.equal(auth.status, 0, detail(auth, secret));
  assert.equal(auth.stdout, "401");
  assert.equal(auth.stderr.includes(secret), false);

  const collapsed = run({ SESSION_SECRET: secret }, "/api?path=profiles/me");
  assert.equal(collapsed.status, 0, detail(collapsed, secret));
  assert.equal(collapsed.stdout, "401");
  assert.equal(collapsed.stderr.includes(secret), false);

  const deep = run(
    { SESSION_SECRET: secret, HANDLER_METHOD: "PATCH" },
    "/api?path=admin/classes/00000000-0000-4000-8000-000000000001/participants/00000000-0000-4000-8000-000000000002/attendance",
  );
  assert.equal(deep.status, 0, detail(deep, secret));
  assert.equal(deep.stdout, "401");
  assert.equal(deep.stderr.includes(secret), false);
});

test("single-origin Vercel handler serves no-origin and same-origin requests, and refuses other credentials", () => {
  const secret = randomBytes(48).toString("base64url");
  const production = "https://app.example.com";
  const base = {
    SESSION_SECRET: secret,
    HANDLER_REPORT: "cors",
    VERCEL_ENV: "production",
    CORS_ALLOWED_ORIGINS: production,
    CORS_ALLOW_VERCEL_PREVIEWS: "false",
  };

  function report(extra) {
    const result = run({ ...base, ...extra }, "/api/healthz");
    assert.equal(result.status, 0, detail(result, secret));
    assert.equal(result.stderr.includes(secret), false);
    return JSON.parse(result.stdout);
  }

  const noOrigin = report({});
  assert.equal(noOrigin.status, 200);
  assert.equal(noOrigin.allowOrigin, null);
  assert.equal(noOrigin.allowCredentials, null);

  const sameOrigin = report({ HANDLER_ORIGIN: production });
  assert.equal(sameOrigin.status, 200);
  assert.equal(sameOrigin.allowOrigin, production);
  assert.equal(sameOrigin.allowCredentials, "true");

  const denied = report({ HANDLER_ORIGIN: "https://evil.example" });
  assert.equal(denied.status, 200);
  assert.equal(denied.allowOrigin, null);
  assert.equal(denied.allowCredentials, null);

  const previewBlocked = report({ HANDLER_ORIGIN: "https://other-preview.vercel.app" });
  assert.equal(previewBlocked.status, 200);
  assert.equal(previewBlocked.allowCredentials, null);
  assert.equal(previewBlocked.allowOrigin, null);
});
