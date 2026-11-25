import assert from "node:assert/strict";
import { createServer, ServerResponse, type IncomingMessage, type Server } from "node:http";
import test from "node:test";

const USER = "bdb8b525-8413-4e51-bc3e-6fcc82737d0a";
const ACCESS = "user-access-token";
const WRONG_PASSWORD = "이메일 또는 비밀번호를 확인해 주세요.";
const COOKIE_ERROR = "로그인 세션을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.";

type AuthState = {
  authStatus: number | null;
  profileStatus: number | null;
  omitEmail: boolean;
  confirmationSignup: "with-email" | "without-email" | "existing" | null;
};

const state: AuthState = {
  authStatus: null,
  profileStatus: null,
  omitEmail: false,
  confirmationSignup: null,
};

function reset(): void {
  state.authStatus = null;
  state.profileStatus = null;
  state.omitEmail = false;
  state.confirmationSignup = null;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function authPayload(email: string): Record<string, unknown> {
  return {
    access_token: ACCESS,
    refresh_token: "refresh-token",
    user: state.omitEmail ? { id: USER } : { id: USER, email },
  };
}

function installFetch(originalFetch: typeof fetch): void {
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname !== "example.test") return originalFetch(input, init);
    const body = typeof init?.body === "string" ? init.body : null;
    const parsed = body ? JSON.parse(body) as { email?: string; password?: string } : {};

    if (url.pathname === "/auth/v1/signup" && state.confirmationSignup === "existing") {
      // Supabase answers a repeated confirm-required signup with an obfuscated user.
      return json(200, {
        id: "6f1a3b2c-0d4e-4f5a-8b6c-7d8e9f0a1b2c",
        aud: "authenticated",
        role: "",
        email: parsed.email ?? "member@example.test",
        identities: [],
        confirmation_sent_at: "2026-11-09T00:00:00.000Z",
        user_metadata: {},
        app_metadata: {},
      });
    }

    if (url.pathname === "/auth/v1/signup" && state.confirmationSignup) {
      const confirmed = {
        id: USER,
        aud: "authenticated",
        confirmation_sent_at: "2026-11-09T00:00:00.000Z",
      };
      return json(200, state.confirmationSignup === "with-email"
        ? { ...confirmed, email: parsed.email ?? "member@example.test" }
        : confirmed);
    }

    if (url.pathname === "/auth/v1/token" || url.pathname === "/auth/v1/signup") {
      if (state.authStatus) {
        return json(state.authStatus, {
          error_code: state.authStatus === 429 ? "over_email_send_rate_limit" : "invalid_credentials",
          msg: state.authStatus === 429 ? "email rate limit exceeded" : "Invalid login credentials",
        });
      }
      return json(200, authPayload(parsed.email ?? "member@example.test"));
    }

    if (url.pathname === "/auth/v1/logout") {
      return new Response(null, { status: 204 });
    }

    if (url.pathname === "/auth/v1/user") {
      return json(200, { id: USER, email: "member@example.test" });
    }

    if (url.pathname === "/rest/v1/rpc/current_consents_complete") return json(200, true);
    if (url.pathname === "/rest/v1/rpc/record_own_consents") return json(200, []);

    if (url.pathname === "/rest/v1/profiles") {
      if (state.profileStatus) return json(state.profileStatus, { message: "profile down" });
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

function readCookieHeader(req: IncomingMessage): Record<string, string> {
  const header = req.headers.cookie;
  const value: Record<string, string> = {};
  if (typeof header !== "string" || header.length === 0) return value;
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const raw = trimmed.slice(eq + 1);
    try {
      value[trimmed.slice(0, eq)] = decodeURIComponent(raw);
    } catch {
      value[trimmed.slice(0, eq)] = raw;
    }
  }
  return value;
}

function installVercelCookies(req: IncomingMessage, configurable = true): void {
  const opts = { configurable, enumerable: true };
  Object.defineProperty(req, "cookies", {
    ...opts,
    get() {
      const value = readCookieHeader(req);
      if (configurable) {
        Object.defineProperty(req, "cookies", { ...opts, writable: true, value });
      }
      return value;
    },
    set(value: Record<string, string>) {
      Object.defineProperty(req, "cookies", { ...opts, writable: true, value });
    },
  });
}

function cookieHeader(response: Response): string {
  return response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
}

async function postAuth(base: string, path: "/api/auth/login" | "/api/auth/signup"): Promise<Response> {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "Member@Example.test", password: "password12" }),
  });
}

let server: Server | undefined;
let base = "";
let emulateVercelCookies = false;
let lockVercelCookies = false;
const originalFetch = globalThis.fetch;
const originalSetHeader = ServerResponse.prototype.setHeader;

test.before(async () => {
  process.env.NODE_ENV = "production";
  process.env.SESSION_SECRET = "test-session-secret";
  process.env.SUPABASE_URL = "https://example.test";
  process.env.SUPABASE_ANON_KEY = "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  process.env.LOG_LEVEL = "silent";
  installFetch(originalFetch);
  const { default: handler } = await import("../dist/vercel-handler.mjs");
  server = createServer((req, res) => {
    if (emulateVercelCookies) installVercelCookies(req, !lockVercelCookies);
    handler(req, res);
  });
  await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server has no port");
  base = `http://127.0.0.1:${address.port}`;
});

test.after(async () => {
  ServerResponse.prototype.setHeader = originalSetHeader;
  globalThis.fetch = originalFetch;
  if (!server) return;
  await new Promise<void>((resolve, reject) => server?.close((error) => error ? reject(error) : resolve()));
});

test.beforeEach(() => {
  reset();
  emulateVercelCookies = false;
  lockVercelCookies = false;
  ServerResponse.prototype.setHeader = originalSetHeader;
});

test("profile lookup failure still returns the session cookie", async () => {
  state.profileStatus = 500;
  const response = await postAuth(base, "/api/auth/login");
  const body = await response.json() as { user: { id: string; email: string }; profile: unknown; error?: string };
  assert.equal(response.status, 200);
  assert.equal(body.user.id, USER);
  assert.equal(body.user.email, "member@example.test");
  assert.equal(body.profile, null);
  assert.equal(body.error, undefined);
  const cookie = cookieHeader(response);
  assert.match(cookie, /swetin_session=/);

  state.profileStatus = null;
  const me = await fetch(`${base}/api/auth/me`, { headers: { cookie } });
  assert.equal(me.status, 200);
  const session = await me.json() as { profile: { display_name: string } | null };
  assert.equal(session.profile?.display_name, "호야");
});

const PENDING_SIGNUP_ID = "00000000-0000-0000-0000-000000000000";
const CHECK_EMAIL = "메일을 확인해 주세요. 인증 메일이 도착하면, 인증을 마친 뒤 로그인해 주세요.";

test("confirm-required signup answers the same for a new and an existing address", async () => {
  const answers: Array<{ status: number; body: string; cookies: string[]; type: string | null }> = [];
  for (const mode of ["with-email", "without-email", "existing"] as const) {
    state.confirmationSignup = mode;
    const response = await postAuth(base, "/api/auth/signup");
    answers.push({
      status: response.status,
      body: await response.text(),
      cookies: response.headers.getSetCookie(),
      type: response.headers.get("content-type"),
    });
  }

  const [created, missingEmail, existing] = answers;
  assert.equal(created.status, 201);
  assert.deepEqual(JSON.parse(created.body), {
    user: { id: PENDING_SIGNUP_ID, email: "member@example.test" },
    profile: null,
    consents_current: false,
  });
  for (const answer of [missingEmail, existing]) {
    assert.equal(answer.status, created.status);
    assert.equal(answer.body, created.body);
    assert.equal(answer.type, created.type);
  }
  for (const answer of answers) {
    assert.deepEqual(answer.cookies, []);
    assert.equal(answer.body.includes(USER), false);
    assert.equal(answer.body.includes("6f1a3b2c"), false);
    assert.equal(answer.body.includes("identities"), false);
    assert.equal(answer.body.includes("error"), false);
    assert.equal(answer.body.includes(CHECK_EMAIL), false);
  }
});

test("signup with a session still returns the real account and cookie", async () => {
  const response = await postAuth(base, "/api/auth/signup");
  const body = await response.json() as { user: { id: string; email: string }; profile: { display_name: string } | null };
  assert.equal(response.status, 201);
  assert.equal(body.user.id, USER);
  assert.equal(body.user.email, "member@example.test");
  assert.equal(body.profile?.display_name, "호야");
  assert.match(cookieHeader(response), /swetin_session=/);
});

test("login cookie keeps its httpOnly, SameSite, path and max-age, and logout clears it", async () => {
  const response = await postAuth(base, "/api/auth/login");
  assert.equal(response.status, 200);
  const [header] = response.headers.getSetCookie().filter((value) => value.startsWith("swetin_session="));
  assert.ok(header);
  assert.match(header, /;\s*HttpOnly/i);
  assert.match(header, /;\s*SameSite=Lax/i);
  assert.match(header, /;\s*Path=\/(;|$)/i);
  assert.match(header, /;\s*Max-Age=1209600/i);
  assert.match(header, /;\s*Secure/i);
  assert.match(header, /^swetin_session=s%3A/);

  const logout = await fetch(`${base}/api/auth/logout`, { method: "POST", headers: { cookie: cookieHeader(response) } });
  assert.equal(logout.status, 204);
  const cleared = logout.headers.getSetCookie().find((value) => value.startsWith("swetin_session="));
  assert.ok(cleared);
  assert.match(cleared, /^swetin_session=;/);
  assert.match(cleared, /Expires=Thu, 01 Jan 1970/i);
});

test("signup rate limits and real auth failures stay failures", async () => {
  state.authStatus = 429;
  const limited = await postAuth(base, "/api/auth/signup");
  assert.equal(limited.status, 429);
  assert.equal((await limited.json() as { error: string }).error, "가입 요청이 많아요. 잠시 후 다시 시도해 주세요.");
  assert.equal(limited.headers.getSetCookie().length, 0);

  state.authStatus = 400;
  const rejected = await postAuth(base, "/api/auth/signup");
  const body = await rejected.json() as { error: string };
  assert.equal(rejected.status, 400);
  assert.equal(body.error, "회원가입에 실패했습니다. 입력한 정보를 확인해 주세요.");
  assert.notEqual(body.error, "가입은 완료됐어요. 이메일 인증을 마친 뒤 로그인해 주세요.");
  assert.notEqual(body.error, CHECK_EMAIL);
  assert.equal(rejected.headers.getSetCookie().length, 0);

  state.authStatus = 422;
  const unprocessable = await postAuth(base, "/api/auth/signup");
  const failed = await unprocessable.json() as { error: string };
  assert.equal(unprocessable.status, 400);
  assert.equal(failed.error, "회원가입에 실패했습니다. 입력한 정보를 확인해 주세요.");
  assert.equal(unprocessable.headers.getSetCookie().length, 0);
});

test("signup profile lookup failure still returns the session cookie", async () => {
  state.profileStatus = 500;
  const response = await postAuth(base, "/api/auth/signup");
  const body = await response.json() as { profile: unknown; error?: string };
  assert.equal(response.status, 201);
  assert.equal(body.profile, null);
  assert.notEqual(body.error, WRONG_PASSWORD);
  assert.match(cookieHeader(response), /swetin_session=/);
});

test("supabase credential rejections stay the wrong-password message", async () => {
  for (const authStatus of [400, 401]) {
    state.authStatus = authStatus;
    const response = await postAuth(base, "/api/auth/login");
    const body = await response.json() as { error: string };
    assert.equal(response.status, 401);
    assert.equal(body.error, WRONG_PASSWORD);
    assert.equal(response.headers.getSetCookie().length, 0);
  }
});

test("a token payload without an email is not reported as a wrong password", async () => {
  state.omitEmail = true;
  const response = await postAuth(base, "/api/auth/login");
  const body = await response.json() as { error: string };
  assert.equal(response.status, 500);
  assert.notEqual(body.error, WRONG_PASSWORD);
  assert.equal(response.headers.getSetCookie().length, 0);
});

test("cookie signing failure is not a wrong-password response", async () => {
  ServerResponse.prototype.setHeader = function (
    this: ServerResponse,
    name: string,
    value: number | string | readonly string[],
  ) {
    const serialized = Array.isArray(value) ? value.join("\n") : String(value);
    if (name.toLowerCase() === "set-cookie" && serialized.includes("swetin_session")) {
      throw new Error("cookie signing failed");
    }
    return originalSetHeader.call(this, name, value);
  };

  const response = await postAuth(base, "/api/auth/login");
  const body = await response.json() as { error: string };
  assert.equal(response.status, 500);
  assert.equal(body.error, COOKIE_ERROR);
  assert.notEqual(body.error, WRONG_PASSWORD);
  assert.equal(response.headers.getSetCookie().length, 0);
});

test("vercel pre-parsed cookies still sign in and read the session", async () => {
  emulateVercelCookies = true;
  const response = await postAuth(base, "/api/auth/login");
  const body = await response.json() as { profile: { display_name: string } | null; error?: string };
  assert.equal(response.status, 200);
  assert.equal(body.profile?.display_name, "호야");
  assert.notEqual(body.error, WRONG_PASSWORD);
  const cookie = cookieHeader(response);
  assert.match(cookie, /swetin_session=/);

  const me = await fetch(`${base}/api/auth/me`, { headers: { cookie } });
  assert.equal(me.status, 200);
});

test("non-configurable platform cookies still sign in and read the session", async () => {
  emulateVercelCookies = true;
  lockVercelCookies = true;
  const response = await postAuth(base, "/api/auth/login");
  assert.equal(response.status, 200);
  const cookie = cookieHeader(response);
  assert.match(cookie, /swetin_session=/);
  const me = await fetch(`${base}/api/auth/me`, { headers: { cookie } });
  assert.equal(me.status, 200);
});
