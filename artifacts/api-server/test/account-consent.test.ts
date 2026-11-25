import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import test from "node:test";

const CONSENT_REQUIRED_ERROR = "이용약관, 개인정보 수집·이용, 국외 이전에 모두 동의해 주세요.";
const GYM_OWNER_DELETE_ERROR = "예정된 클래스가 있는 체육관의 관장은 탈퇴할 수 없어요. 예정된 클래스를 취소하거나, 운영자에게 관장 권한 이전을 요청한 뒤 다시 탈퇴해 주세요.";
const DELETE_CONFIRMATION = "탈퇴";

const USER = "11111111-1111-4111-8111-111111111111";
const ACCESS = "user-access-token";
const ANON = "test-anon-key";
const SERVICE = "test-service-role-key";

type Call = { method: string; pathname: string; authorization: string; apikey: string; body: string | null };

const calls: Call[] = [];
const state: { consents: boolean; deleteError: string | null; storageStatus: number; storedPhoto: string } = {
  consents: false,
  deleteError: null,
  storageStatus: 200,
  storedPhoto: "https://example.test/photo.png",
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function installFetch(originalFetch: typeof fetch): void {
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname !== "example.test") return originalFetch(input, init);
    const headers = new Headers(init?.headers);
    const body = typeof init?.body === "string" ? init.body : null;
    const call = {
      method: init?.method ?? "GET",
      pathname: url.pathname,
      authorization: headers.get("authorization") ?? "",
      apikey: headers.get("apikey") ?? "",
      body,
    };
    calls.push(call);

    if (url.pathname === "/auth/v1/token") {
      return json(200, {
        access_token: ACCESS,
        refresh_token: "refresh-token",
        user: { id: USER, email: "member@example.test" },
      });
    }
    if (url.pathname === "/auth/v1/user") return json(200, { id: USER, email: "member@example.test" });
    if (url.pathname === "/auth/v1/logout") return new Response(null, { status: 204 });
    if (url.pathname === "/rest/v1/profiles") {
      return json(200, [{
        id: USER,
        display_name: "Member",
        birth_year: 1994,
        age_preference: "both",
        gender: null,
        profile_photo_url: state.storedPhoto,
        sports: ["러닝"],
        interests: ["커피"],
        bio: null,
        is_admin: false,
        created_at: "2026-10-01T00:00:00.000Z",
        updated_at: "2026-10-01T00:00:00.000Z",
      }]);
    }
    if (url.pathname === "/rest/v1/rpc/current_consents_complete") return json(200, state.consents);
    if (url.pathname === "/rest/v1/rpc/record_own_consents") {
      state.consents = true;
      return json(200, [
        { user_id: USER, kind: "terms", version: "2026-11-12", accepted_at: "2026-11-12T00:00:00.000Z" },
        { user_id: USER, kind: "privacy", version: "2026-11-12", accepted_at: "2026-11-12T00:00:00.000Z" },
        { user_id: USER, kind: "overseas_transfer", version: "2026-11-12", accepted_at: "2026-11-12T00:00:00.000Z" },
      ]);
    }
    if (url.pathname === "/rest/v1/rpc/assert_own_account_deletable") {
      if (state.deleteError === "gym_owner_upcoming_classes") return json(400, { message: state.deleteError });
      return new Response(null, { status: 204 });
    }
    if (url.pathname === "/storage/v1/object/list/profile-photos") {
      return json(200, [{ name: "avatar.webp" }, { name: "old-extra.png" }]);
    }
    if (url.pathname === "/storage/v1/object/profile-photos" && call.method === "DELETE") {
      if (state.storageStatus !== 200) return json(state.storageStatus, { message: "storage unavailable" });
      return json(200, []);
    }
    if (url.pathname === "/rest/v1/rpc/delete_own_account") {
      if (state.deleteError && state.deleteError !== "gym_owner_upcoming_classes") {
        return json(400, { message: state.deleteError });
      }
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected Supabase request ${call.method} ${url.pathname}`);
  };
}

function cookieHeader(response: Response): string {
  return response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
}

let server: Server | undefined;
let base = "";
const originalFetch = globalThis.fetch;

test.before(async () => {
  process.env.NODE_ENV = "production";
  process.env.SESSION_SECRET = "test-session-secret";
  process.env.SUPABASE_URL = "https://example.test";
  process.env.SUPABASE_ANON_KEY = ANON;
  process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE;
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
  state.consents = false;
  state.deleteError = null;
  state.storageStatus = 200;
  state.storedPhoto = "https://example.test/photo.png";
});

async function login(): Promise<string> {
  const response = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "member@example.test", password: "password12" }),
  });
  assert.equal(response.status, 200);
  const body = await response.json() as { consents_current: boolean };
  assert.equal(body.consents_current, false);
  return cookieHeader(response);
}

test("profile save is refused until the current consents exist", async () => {
  const cookie = await login();
  calls.length = 0;
  const response = await fetch(`${base}/api/profiles/me`, {
    method: "PUT",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({
      display_name: "Member",
      birth_year: 1994,
      age_preference: "both",
      profile_photo_url: "https://example.test/photo.png",
      sports: ["러닝"],
      interests: ["커피"],
    }),
  });
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: CONSENT_REQUIRED_ERROR });
  assert.equal(calls.some((call) => call.pathname === "/rest/v1/profiles" && call.method === "PATCH"), false);
});

test("accepting consents stores all three through the member token and omits the user id", async () => {
  const cookie = await login();
  calls.length = 0;
  const missing = await fetch(`${base}/api/account/consents`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ terms: true, privacy: true, overseas_transfer: false }),
  });
  assert.equal(missing.status, 400);
  assert.equal(calls.some((call) => call.pathname === "/rest/v1/rpc/record_own_consents"), false);

  const response = await fetch(`${base}/api/account/consents`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ terms: true, privacy: true, overseas_transfer: true }),
  });
  assert.equal(response.status, 200);
  const body = await response.json() as { consents_current: boolean; records: Array<{ kind: string; version: string; user_id?: string }> };
  assert.equal(body.consents_current, true);
  assert.deepEqual(body.records.map((row) => row.kind), ["terms", "privacy", "overseas_transfer"]);
  assert.deepEqual(body.records.map((row) => row.version), ["2026-11-12", "2026-11-12", "2026-11-12"]);
  assert.equal(JSON.stringify(body).includes(USER), false);
  const recorded = calls.find((call) => call.pathname === "/rest/v1/rpc/record_own_consents");
  assert.ok(recorded);
  assert.equal(recorded.authorization, `Bearer ${ACCESS}`);
  assert.equal(recorded.apikey, ANON);
  assert.equal(recorded.apikey === SERVICE, false);
  assert.deepEqual(JSON.parse(recorded.body ?? "{}"), { p_terms: true, p_privacy: true, p_overseas: true });
});

test("account deletion requires the confirmation phrase and deletes only through the member token", async () => {
  const cookie = await login();
  calls.length = 0;
  const unconfirmed = await fetch(`${base}/api/account/deletion`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ confirm: "탈퇴합니다" }),
  });
  assert.equal(unconfirmed.status, 400);
  assert.equal(calls.some((call) => call.pathname === "/rest/v1/rpc/delete_own_account"), false);

  state.deleteError = "gym_owner_upcoming_classes";
  const blocked = await fetch(`${base}/api/account/deletion`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ confirm: DELETE_CONFIRMATION }),
  });
  assert.equal(blocked.status, 409);
  assert.deepEqual(await blocked.json(), { error: GYM_OWNER_DELETE_ERROR });
  assert.equal(calls.some((call) => call.pathname.startsWith("/storage/v1/")), false);
  assert.equal(calls.some((call) => call.pathname === "/rest/v1/rpc/delete_own_account"), false);

  state.deleteError = null;
  state.storedPhoto = `profile-photos/${USER}/avatar.webp`;
  state.storageStatus = 500;
  calls.length = 0;
  const storageFailed = await fetch(`${base}/api/account/deletion`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ confirm: DELETE_CONFIRMATION }),
  });
  assert.equal(storageFailed.status, 400);
  assert.equal(calls.some((call) => call.pathname === "/rest/v1/rpc/delete_own_account"), false);

  state.storageStatus = 404;
  calls.length = 0;
  const missingPhoto = await fetch(`${base}/api/account/deletion`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ confirm: DELETE_CONFIRMATION }),
  });
  assert.equal(missingPhoto.status, 200);

  state.storageStatus = 200;
  calls.length = 0;
  const response = await fetch(`${base}/api/account/deletion`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ confirm: DELETE_CONFIRMATION }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { deleted: true });
  const listed = calls.find((call) => call.pathname === "/storage/v1/object/list/profile-photos");
  const removed = calls.find((call) => call.pathname === "/storage/v1/object/profile-photos" && call.method === "DELETE");
  const deleted = calls.find((call) => call.pathname === "/rest/v1/rpc/delete_own_account");
  assert.ok(listed);
  assert.ok(removed);
  assert.ok(deleted);
  assert.ok(calls.indexOf(removed) < calls.indexOf(deleted));
  assert.equal(removed.authorization, `Bearer ${SERVICE}`);
  assert.equal(removed.apikey, SERVICE);
  assert.equal(deleted.authorization, `Bearer ${ACCESS}`);
  assert.equal(deleted.apikey, ANON);
  const paths = JSON.parse(removed.body ?? "[]") as string[];
  assert.deepEqual(paths.slice(0, 4), [
    `${USER}/avatar.jpg`,
    `${USER}/avatar.jpeg`,
    `${USER}/avatar.png`,
    `${USER}/avatar.webp`,
  ]);
  assert.equal(paths.includes(`${USER}/old-extra.png`), true);
  assert.equal(paths.some((path) => path.startsWith("22222222-")), false);
  assert.equal(JSON.stringify(deleted).includes(USER), false);
});
