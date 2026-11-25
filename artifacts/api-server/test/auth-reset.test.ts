import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import test from "node:test";

const USER = "bdb8b525-8413-4e51-bc3e-6fcc82737d0a";
const ACCESS = "user-access-token";
const RECOVERY = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.signature";
const SENT = "메일을 확인해 주세요. 가입된 주소라면 재설정 링크가 도착해요.";
const LINK_INVALID = "재설정 링크가 만료됐거나 올바르지 않아요. 로그인 화면에서 다시 요청해 주세요.";
const PASSWORD_INVALID = "비밀번호는 10자 이상이어야 합니다.";
const SAME_PASSWORD = "지금 쓰는 비밀번호와 다른 비밀번호로 정해 주세요.";
const WEAK_PASSWORD = "더 안전한 비밀번호로 정해 주세요.";
const LOGIN_FOLLOWUP = "비밀번호를 바꿨어요. 새 비밀번호로 로그인해 주세요.";

type Call = {
  method: string;
  pathname: string;
  search: string;
  authorization: string;
  apikey: string;
  body: string | null;
};

type AuthState = {
  recoverStatus: number | null;
  recoverBody: Record<string, unknown> | null;
  updateStatus: number | null;
  updateBody: Record<string, unknown> | null;
  updateUser: { id?: string; email?: string } | null;
  loginStatus: number | null;
  profileStatus: number | null;
  calls: Call[];
};

const state: AuthState = {
  recoverStatus: null,
  recoverBody: null,
  updateStatus: null,
  updateBody: null,
  updateUser: null,
  loginStatus: null,
  profileStatus: null,
  calls: [],
};

function reset(): void {
  state.recoverStatus = null;
  state.recoverBody = null;
  state.updateStatus = null;
  state.updateBody = null;
  state.updateUser = null;
  state.loginStatus = null;
  state.profileStatus = null;
  state.calls = [];
}

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
    const headers = new Headers(init?.headers);
    const body = typeof init?.body === "string" ? init.body : null;
    state.calls.push({
      method: init?.method ?? "GET",
      pathname: url.pathname,
      search: url.search,
      authorization: headers.get("authorization") ?? "",
      apikey: headers.get("apikey") ?? "",
      body,
    });

    if (url.pathname === "/auth/v1/recover") {
      if (state.recoverStatus) return json(state.recoverStatus, state.recoverBody ?? { msg: "rate limit" });
      return json(200, {});
    }

    if (url.pathname === "/auth/v1/user") {
      const method = init?.method ?? "GET";
      if (state.updateStatus) return json(state.updateStatus, state.updateBody ?? { msg: "invalid token" });
      if (method === "PUT") {
        return json(200, state.updateUser ?? { id: USER, email: "member@example.test" });
      }
      return json(200, state.updateUser ?? { id: USER, email: "member@example.test" });
    }

    if (url.pathname === "/auth/v1/token") {
      if (state.loginStatus) return json(state.loginStatus, { error_code: "invalid_credentials", msg: "Invalid login credentials" });
      const parsed = body ? JSON.parse(body) as { email?: string } : {};
      return json(200, {
        access_token: ACCESS,
        refresh_token: "refresh-token",
        user: { id: USER, email: parsed.email ?? "member@example.test" },
      });
    }

    if (url.pathname === "/rest/v1/rpc/current_consents_complete") return json(200, true);

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

function cookieHeader(response: Response): string {
  return response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
}

async function post(path: string, body: unknown): Promise<Response> {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
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
  reset();
});

test("recovery asks supabase for an implicit email and hides whether the address exists", async () => {
  const sent = await post("/api/auth/recover", { email: "Member@Example.test" });
  const sentBody = await sent.json() as { message: string };
  assert.equal(sent.status, 200);
  assert.equal(sentBody.message, SENT);
  assert.equal(state.calls.length, 1);
  const call = state.calls[0];
  assert.equal(call.pathname, "/auth/v1/recover");
  assert.equal(call.method, "POST");
  assert.equal(call.apikey, "test-anon-key");
  assert.equal(call.authorization, "Bearer test-anon-key");
  assert.deepEqual(JSON.parse(call.body ?? "{}"), { email: "member@example.test" });
  const redirect = new URL(base).origin;
  const params = new URLSearchParams(call.search);
  assert.equal(params.get("redirect_to"), `${redirect}/reset-password`);
  assert.equal(params.get("code_challenge"), null);

  state.calls = [];
  state.recoverStatus = 429;
  state.recoverBody = { error_code: "over_email_send_rate_limit", msg: "email rate limit exceeded" };
  const limited = await post("/api/auth/recover", { email: "member@example.test" });
  assert.equal(limited.status, sent.status);
  assert.deepEqual(await limited.json(), sentBody);

  state.calls = [];
  state.recoverStatus = 400;
  state.recoverBody = { error_code: "user_not_found", msg: "User not found" };
  const missing = await post("/api/auth/recover", { email: "missing@example.test" });
  assert.equal(missing.status, 200);
  assert.deepEqual(await missing.json(), sentBody);
});

test("a malformed recovery address does not call supabase", async () => {
  const response = await post("/api/auth/recover", { email: "not-an-email" });
  const body = await response.json() as { error: string };
  assert.equal(response.status, 400);
  assert.equal(body.error, "이메일 주소를 확인해 주세요.");
  assert.equal(state.calls.length, 0);
});

test("a recovery network failure is not described as a sent email", async () => {
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname !== "example.test") return originalFetch(input, init);
    throw new Error("socket hang up");
  };
  try {
    const response = await post("/api/auth/recover", { email: "member@example.test" });
    const body = await response.json() as { error: string; message?: string };
    assert.equal(response.status, 500);
    assert.equal(body.error, "재설정 메일을 보내지 못했어요. 잠시 후 다시 시도해 주세요.");
    assert.equal(body.message, undefined);
  } finally {
    installFetch(originalFetch);
  }
});

test("reset password updates the recovery session, then signs in with the new password", async () => {
  const response = await post("/api/auth/reset-password", {
    access_token: RECOVERY,
    password: "lakehouse42",
  });
  const body = await response.json() as {
    message: string;
    session: { user: { id: string; email: string }; profile: { display_name: string } | null };
  };
  assert.equal(response.status, 200);
  assert.equal(body.message, "비밀번호를 바꿨어요.");
  assert.equal(body.session.user.email, "member@example.test");
  assert.equal(body.session.profile?.display_name, "호야");
  assert.match(cookieHeader(response), /swetin_session=/);
  assert.equal(state.calls[0]?.pathname, "/auth/v1/user");
  assert.equal(state.calls[0]?.method, "GET");
  assert.equal(state.calls[0]?.authorization, `Bearer ${RECOVERY}`);
  assert.equal(state.calls[0]?.apikey, "test-anon-key");
  assert.equal(state.calls[1]?.pathname, "/auth/v1/user");
  assert.equal(state.calls[1]?.method, "PUT");
  assert.equal(state.calls[1]?.authorization, `Bearer ${RECOVERY}`);
  assert.deepEqual(JSON.parse(state.calls[1]?.body ?? "{}"), { password: "lakehouse42" });
  assert.equal(state.calls[2]?.pathname, "/auth/v1/token");
  assert.match(state.calls[2]?.search ?? "", /grant_type=password/);
  assert.deepEqual(JSON.parse(state.calls[2]?.body ?? "{}"), {
    email: "member@example.test",
    password: "lakehouse42",
  });
  assert.equal(JSON.stringify(body).includes(RECOVERY), false);
});

test("profile lookup failure after reset still keeps the new session", async () => {
  state.profileStatus = 500;
  const response = await post("/api/auth/reset-password", {
    access_token: RECOVERY,
    password: "lakehouse42",
  });
  const body = await response.json() as { session: { profile: unknown } };
  assert.equal(response.status, 200);
  assert.equal(body.session.profile, null);
  assert.match(cookieHeader(response), /swetin_session=/);
});

test("an expired recovery token does not set a session", async () => {
  state.updateStatus = 401;
  state.updateBody = { error_code: "otp_expired", msg: "Email link is invalid or has expired" };
  const response = await post("/api/auth/reset-password", {
    access_token: RECOVERY,
    password: "lakehouse42",
  });
  const body = await response.json() as { error: string };
  assert.equal(response.status, 401);
  assert.equal(body.error, LINK_INVALID);
  assert.equal(response.headers.getSetCookie().length, 0);
  assert.equal(state.calls.some((call) => call.pathname === "/auth/v1/token"), false);
});

test("a short password and a token that is not a recovery session are rejected locally", async () => {
  const short = await post("/api/auth/reset-password", { access_token: RECOVERY, password: "short" });
  assert.equal(short.status, 400);
  assert.equal((await short.json() as { error: string }).error, PASSWORD_INVALID);
  const token = await post("/api/auth/reset-password", { access_token: "not-a-jwt", password: "lakehouse42" });
  assert.equal(token.status, 401);
  assert.equal((await token.json() as { error: string }).error, LINK_INVALID);
  assert.equal(state.calls.length, 0);
});

test("supabase password rules stay in Korean and do not keep the recovery session", async () => {
  state.updateStatus = 422;
  state.updateBody = { error_code: "same_password", msg: "New password should be different from the old password." };
  const same = await post("/api/auth/reset-password", { access_token: RECOVERY, password: "lakehouse42" });
  assert.equal(same.status, 400);
  assert.equal((await same.json() as { error: string }).error, SAME_PASSWORD);
  assert.equal(same.headers.getSetCookie().length, 0);

  state.calls = [];
  state.updateStatus = 422;
  state.updateBody = { error_code: "weak_password", msg: "Password is known to be weak and easy to guess" };
  const weak = await post("/api/auth/reset-password", { access_token: RECOVERY, password: "lakehouse42" });
  assert.equal(weak.status, 400);
  assert.equal((await weak.json() as { error: string }).error, WEAK_PASSWORD);
});

test("a changed password can still be used when the follow-up sign-in fails", async () => {
  state.loginStatus = 401;
  const response = await post("/api/auth/reset-password", {
    access_token: RECOVERY,
    password: "lakehouse42",
  });
  const body = await response.json() as { message: string; session: unknown; error?: string };
  assert.equal(response.status, 200);
  assert.equal(body.message, LOGIN_FOLLOWUP);
  assert.equal(body.session, null);
  assert.equal(body.error, undefined);
  assert.equal(response.headers.getSetCookie().length, 0);
  assert.equal(state.calls[0]?.pathname, "/auth/v1/user");
  assert.equal(state.calls[0]?.method, "GET");
  assert.equal(state.calls[1]?.pathname, "/auth/v1/user");
  assert.equal(state.calls[1]?.method, "PUT");
  assert.equal(state.calls[2]?.pathname, "/auth/v1/token");
});

test("common or email-based new passwords are rejected locally", async () => {
  const common = await post("/api/auth/reset-password", { access_token: RECOVERY, password: "1q2w3e4r5t" });
  assert.equal(common.status, 400);
  assert.equal((await common.json() as { error: string }).error, "너무 흔한 비밀번호입니다. 다른 비밀번호를 사용해 주세요.");
  assert.equal(state.calls.length, 0);

  const email = await post("/api/auth/reset-password", { access_token: RECOVERY, password: "member12345" });
  assert.equal(email.status, 400);
  assert.equal((await email.json() as { error: string }).error, "비밀번호에 이메일 주소를 넣지 마세요.");
  assert.equal(state.calls.some((call) => call.method === "PUT"), false);
});
