import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import test from "node:test";
import { KAKAO_CONSENT_ITEMS } from "../src/lib/kakao-consent.ts";

const USER = "bdb8b525-8413-4e51-bc3e-6fcc82737d0a";
const ACCESS = "user-access-token";
const EXPIRED = "Google 로그인 확인 정보가 만료됐어요. 다시 시도해 주세요.";

type Call = { pathname: string; search: string; body: string | null };

const calls: Call[] = [];
let profileStatus: number | null = null;
let tokenStatus: number | null = null;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function installFetch(originalFetch: typeof fetch): void {
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname !== "example.test") return originalFetch(input, init);
    const body = typeof init?.body === "string" ? init.body : null;
    calls.push({ pathname: url.pathname, search: url.search, body });

    if (url.pathname === "/auth/v1/token") {
      if (tokenStatus) return json(tokenStatus, { error_code: "invalid_grant", msg: "invalid code" });
      const parsed = body ? JSON.parse(body) as { auth_code?: string; code_verifier?: string } : {};
      if (!parsed.auth_code || !parsed.code_verifier) return json(400, { msg: "missing pkce" });
      return json(200, {
        access_token: ACCESS,
        refresh_token: "refresh-token",
        user: { id: USER, email: "member@example.test" },
      });
    }

    if (url.pathname === "/rest/v1/profiles") {
      if (profileStatus) return json(profileStatus, { message: "profile down" });
      return json(200, [{
        id: USER,
        display_name: "호야",
        birth_year: null,
        gender: null,
        profile_photo_url: "https://example.test/photo.png",
        sports: [],
        interests: [],
        bio: null,
        is_admin: false,
        created_at: "2026-10-01T00:00:00.000Z",
        updated_at: "2026-10-01T00:00:00.000Z",
      }]);
    }

    throw new Error(`Unexpected Supabase request ${url.pathname}`);
  };
}

function cookiePairs(response: Response): string {
  return response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
}

function verifierCookie(response: Response, provider: "google" | "kakao"): string {
  const name = `swetin_${provider}_oauth_verifier`;
  const header = response.headers.getSetCookie().find((value) => value.startsWith(`${name}=`));
  assert.ok(header, `${name} cookie`);
  assert.match(header, /Path=\//);
  assert.match(header, /HttpOnly/i);
  assert.match(header, /SameSite=Lax/i);
  assert.doesNotMatch(header, /Path=\/api\/auth/);
  return header.split(";")[0];
}

let server: Server | undefined;
let base = "";
const originalFetch = globalThis.fetch;

test.before(async () => {
  process.env.NODE_ENV = "production";
  process.env.SESSION_SECRET = "test-session-secret";
  process.env.SUPABASE_URL = "https://example.test";
  process.env.SUPABASE_ANON_KEY = "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  process.env.LOG_LEVEL = "silent";
  installFetch(originalFetch);
  const { default: handler } = await import("../dist/vercel-handler.mjs");
  server = createServer((req, res) => handler(req, res));
  await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server has no port");
  base = `http://127.0.0.1:${address.port}`;
});

test.after(async () => {
  globalThis.fetch = originalFetch;
  if (!server) return;
  await new Promise<void>((resolve, reject) => server?.close((error) => error ? reject(error) : resolve()));
});

test.beforeEach(() => {
  calls.length = 0;
  profileStatus = null;
  tokenStatus = null;
});

test("Kakao consent items are the ones Supabase always requests", () => {
  assert.deepEqual(KAKAO_CONSENT_ITEMS, ["account_email", "profile_nickname", "profile_image"]);
});

test("OAuth start stores only the verifier and does not send a Supabase state or Kakao scopes override", async () => {
  for (const provider of ["google", "kakao"] as const) {
    const response = await fetch(`${base}/api/auth/${provider}/start`, { redirect: "manual" });
    assert.equal(response.status, 302);
    const location = new URL(response.headers.get("location") ?? "");
    assert.equal(location.pathname, "/auth/v1/authorize");
    assert.equal(location.searchParams.get("provider"), provider);
    assert.equal(location.searchParams.get("state"), null);
    assert.equal(location.searchParams.get("scopes"), null);
    assert.equal(location.searchParams.get("flow_type"), "pkce");
    assert.ok(location.searchParams.get("code_challenge"));
    const names = response.headers.getSetCookie().map((value) => value.split("=")[0]);
    assert.deepEqual(names, [`swetin_${provider}_oauth_verifier`]);
    verifierCookie(response, provider);
  }
});

test("a provider callback with the verifier cookie and only a code sets the session", async () => {
  const start = await fetch(`${base}/api/auth/google/start`, { redirect: "manual" });
  const verifier = verifierCookie(start, "google");
  const response = await fetch(`${base}/api/auth/google/callback?code=auth-code-1`, {
    redirect: "manual",
    headers: { cookie: verifier },
  });
  assert.equal(response.status, 302);
  assert.match(response.headers.get("location") ?? "", /\/home$/);
  assert.match(cookiePairs(response), /swetin_session=/);
  const exchange = calls.find((call) => call.pathname === "/auth/v1/token");
  const body = JSON.parse(exchange?.body ?? "{}") as { auth_code?: string; code_verifier?: string };
  assert.equal(body.auth_code, "auth-code-1");
  assert.equal(typeof body.code_verifier, "string");
  assert.ok((body.code_verifier ?? "").length >= 32);
  assert.match(exchange?.search ?? "", /grant_type=pkce/);
});

test("a callback without the verifier cookie is the expired confirmation, even when a code and state arrive", async () => {
  const response = await fetch(`${base}/api/auth/google/callback?code=auth-code-1&state=supabase-flow-state`, {
    redirect: "manual",
  });
  assert.equal(response.status, 302);
  const location = new URL(response.headers.get("location") ?? "");
  assert.equal(location.pathname, "/login");
  assert.equal(location.searchParams.get("oauth_error"), EXPIRED);
  assert.equal(cookiePairs(response).includes("swetin_session"), false);
  assert.equal(calls.length, 0);
});

test("a profile lookup failure after OAuth still keeps the session and opens profile setup", async () => {
  profileStatus = 500;
  const start = await fetch(`${base}/api/auth/kakao/start`, { redirect: "manual" });
  const verifier = verifierCookie(start, "kakao");
  const response = await fetch(`${base}/api/auth/kakao/callback?code=auth-code-2`, {
    redirect: "manual",
    headers: { cookie: verifier },
  });
  assert.equal(response.status, 302);
  assert.match(response.headers.get("location") ?? "", /\/profile$/);
  assert.match(cookiePairs(response), /swetin_session=/);
  assert.equal(new URL(response.headers.get("location") ?? "").searchParams.get("oauth_error"), null);
});

test("a rejected provider code is not described as an expired confirmation", async () => {
  tokenStatus = 400;
  const start = await fetch(`${base}/api/auth/google/start`, { redirect: "manual" });
  const verifier = verifierCookie(start, "google");
  const response = await fetch(`${base}/api/auth/google/callback?code=stale-code`, {
    redirect: "manual",
    headers: { cookie: verifier },
  });
  assert.equal(response.status, 302);
  const location = new URL(response.headers.get("location") ?? "");
  assert.equal(location.pathname, "/login");
  assert.equal(location.searchParams.get("oauth_error"), "Google 로그인에 실패했어요. 잠시 후 다시 시도해 주세요.");
  assert.notEqual(location.searchParams.get("oauth_error"), EXPIRED);
  assert.equal(cookiePairs(response).includes("swetin_session"), false);
});
