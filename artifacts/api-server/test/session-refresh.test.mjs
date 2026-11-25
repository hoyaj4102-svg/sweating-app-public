import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { once } from "node:events";
import { register } from "node:module";
import test from "node:test";

register(new URL("./resolve-ts.mjs", import.meta.url), import.meta.url);

process.env.NODE_ENV = "production";
process.env.SESSION_SECRET = "test-only-session-secret";
process.env.SUPABASE_URL = "https://example.test";
process.env.SUPABASE_ANON_KEY = "test-anon";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service";
process.env.LOG_LEVEL = "silent";

const { createApp } = await import("../src/create-app.ts");

const USER = "11111111-1111-4111-8111-111111111111";
const EXPIRED = "expired-access-token";
const FRESH = "fresh-access-token";
const REFRESH = "refresh-token-1";
const ROTATED = "refresh-token-2";
const ANON = "test-anon";
const originalFetch = globalThis.fetch;

function signSession(session) {
  const value = JSON.stringify(session);
  const signature = createHmac("sha256", process.env.SESSION_SECRET)
    .update(value)
    .digest("base64")
    .replace(/=+$/, "");
  return `swetin_session=${encodeURIComponent(`s:${value}.${signature}`)}`;
}

function cookiePair(setCookie) {
  return setCookie.split(";")[0];
}

function assertSessionCookieAttributes(header) {
  assert.match(header, /HttpOnly/);
  assert.match(header, /SameSite=Lax/);
  assert.match(header, /Secure/);
  assert.match(header, /Path=\//);
  assert.match(header, /Max-Age=1209600/);
}

function readSignedSession(setCookie) {
  const encoded = cookiePair(setCookie).slice("swetin_session=".length);
  const raw = decodeURIComponent(encoded);
  assert.equal(raw.startsWith("s:"), true);
  const signed = raw.slice(2);
  const dot = signed.lastIndexOf(".");
  const json = signed.slice(0, dot);
  const signature = signed.slice(dot + 1);
  const expected = createHmac("sha256", process.env.SESSION_SECRET)
    .update(json)
    .digest("base64")
    .replace(/=+$/, "");
  assert.equal(signature, expected);
  return JSON.parse(json);
}

function installFetch({ refreshStatus = 200, refreshBody, acceptAccess = FRESH, onRefresh, onUser } = {}) {
  const calls = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname !== "example.test") return originalFetch(input, init);
    const headers = new Headers(init?.headers);
    const body = typeof init?.body === "string" ? init.body : null;
    const call = {
      method: init?.method ?? "GET",
      pathname: url.pathname,
      search: url.search,
      authorization: headers.get("authorization") ?? "",
      apikey: headers.get("apikey") ?? "",
      body,
    };
    calls.push(call);

    if (url.pathname === "/auth/v1/user") {
      if (onUser) await onUser();
      if (call.authorization === `Bearer ${acceptAccess}`) {
        return Response.json({ id: USER, email: "member@example.test" });
      }
      return Response.json({ message: "token is expired" }, { status: 401 });
    }

    if (url.pathname === "/auth/v1/token") {
      if (onRefresh) await onRefresh();
      if (refreshStatus !== 200) {
        return Response.json({ message: "invalid_grant" }, { status: refreshStatus });
      }
      return Response.json(
        refreshBody ?? {
          access_token: FRESH,
          refresh_token: ROTATED,
          token_type: "bearer",
          expires_in: 3600,
          user: { id: USER, email: "member@example.test" },
        },
      );
    }

    if (url.pathname === "/rest/v1/profiles") return Response.json([]);
    return Response.json({ message: "unexpected" }, { status: 500 });
  };
  return calls;
}

function restoreFetch() {
  globalThis.fetch = originalFetch;
}

async function listen(app) {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

function expiredCookie() {
  return signSession({
    accessToken: EXPIRED,
    refreshToken: REFRESH,
    user: { id: USER, email: "old@example.test" },
  });
}

async function withApi(run, fetchOptions) {
  const calls = installFetch(fetchOptions);
  const server = await listen(createApp());
  try {
    await run(server.base, calls);
  } finally {
    restoreFetch();
    await server.close();
  }
}

test("expired access token with a valid refresh token renews the session", async () => {
  await withApi(async (base, calls) => {
    const response = await fetch(`${base}/api/auth/me`, { headers: { cookie: expiredCookie() } });
    assert.equal(response.status, 200);
    const setCookie = response.headers.getSetCookie();
    assert.equal(setCookie.length, 1);
    assertSessionCookieAttributes(setCookie[0]);
    assert.deepEqual(readSignedSession(setCookie[0]), {
      accessToken: FRESH,
      refreshToken: ROTATED,
      user: { id: USER, email: "member@example.test" },
    });

    const body = await response.json();
    assert.deepEqual(body.user, { id: USER, email: "member@example.test" });
    assert.equal(body.profile, null);
    const encoded = JSON.stringify(body);
    assert.equal(encoded.includes(FRESH), false);
    assert.equal(encoded.includes(ROTATED), false);
    assert.equal(encoded.includes(REFRESH), false);

    const refresh = calls.filter((call) => call.pathname === "/auth/v1/token");
    assert.equal(refresh.length, 1);
    assert.equal(refresh[0].method, "POST");
    assert.equal(refresh[0].search, "?grant_type=refresh_token");
    assert.equal(refresh[0].authorization, `Bearer ${ANON}`);
    assert.equal(refresh[0].apikey, ANON);
    assert.equal(refresh[0].body, JSON.stringify({ refresh_token: REFRESH }));
    assert.equal(calls.find((call) => call.pathname === "/auth/v1/user").authorization, `Bearer ${EXPIRED}`);
    assert.equal(
      calls.find((call) => call.pathname === "/rest/v1/profiles").authorization,
      `Bearer ${FRESH}`,
    );

    calls.length = 0;
    const again = await fetch(`${base}/api/auth/me`, { headers: { cookie: cookiePair(setCookie[0]) } });
    assert.equal(again.status, 200);
    assert.equal(again.headers.getSetCookie().length, 0);
    assert.equal(calls.some((call) => call.pathname === "/auth/v1/token"), false);
    assert.equal(
      calls.some((call) => call.pathname === "/auth/v1/user" && call.authorization === `Bearer ${FRESH}`),
      true,
    );
  });
});

test("failed refresh clears the session", async () => {
  await withApi(async (base, calls) => {
    const response = await fetch(`${base}/api/auth/me`, { headers: { cookie: expiredCookie() } });
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "로그인이 필요합니다." });
    const setCookie = response.headers.getSetCookie();
    assert.equal(setCookie.length, 1);
    assert.match(setCookie[0], /^swetin_session=;/);
    assert.match(setCookie[0], /Expires=Thu, 01 Jan 1970/);
    assert.equal(calls.filter((call) => call.pathname === "/auth/v1/token").length, 1);
    assert.equal(calls.some((call) => call.pathname === "/rest/v1/profiles"), false);

    calls.length = 0;
    const again = await fetch(`${base}/api/auth/me`, { headers: { cookie: cookiePair(setCookie[0]) } });
    assert.equal(again.status, 401);
    assert.equal(calls.length, 0);
  }, { refreshStatus: 400 });
});

test("expired access token without a refresh token clears the session", async () => {
  await withApi(async (base, calls) => {
    const cookie = signSession({
      accessToken: EXPIRED,
      user: { id: USER, email: "old@example.test" },
    });
    const response = await fetch(`${base}/api/auth/me`, { headers: { cookie } });
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "로그인이 필요합니다." });
    const setCookie = response.headers.getSetCookie();
    assert.equal(setCookie.length, 1);
    assert.match(setCookie[0], /^swetin_session=;/);
    assert.equal(calls.some((call) => call.pathname === "/auth/v1/token"), false);
    assert.equal(calls.filter((call) => call.pathname === "/auth/v1/user").length, 1);
  });
});

test("refresh response without a rotated refresh token clears the session", async () => {
  await withApi(async (base, calls) => {
    const response = await fetch(`${base}/api/auth/me`, { headers: { cookie: expiredCookie() } });
    assert.equal(response.status, 401);
    assert.match(response.headers.getSetCookie()[0], /^swetin_session=;/);
    assert.equal(calls.some((call) => call.pathname === "/rest/v1/profiles"), false);
  }, {
    refreshBody: {
      access_token: FRESH,
      token_type: "bearer",
      expires_in: 3600,
      user: { id: USER, email: "member@example.test" },
    },
  });
});

test("valid access token does not refresh or rewrite the session cookie", async () => {
  await withApi(async (base, calls) => {
    const response = await fetch(`${base}/api/auth/me`, {
      headers: {
        cookie: signSession({
          accessToken: EXPIRED,
          refreshToken: REFRESH,
          user: { id: USER, email: "member@example.test" },
        }),
      },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.getSetCookie().length, 0);
    assert.equal(calls.some((call) => call.pathname === "/auth/v1/token"), false);
    assert.deepEqual((await response.json()).user, { id: USER, email: "member@example.test" });
  }, { acceptAccess: EXPIRED });
});

test("parallel expired sessions share one refresh request", async () => {
  let releaseRefresh;
  const refreshGate = new Promise((resolve) => {
    releaseRefresh = resolve;
  });
  let releaseUsers;
  const usersGate = new Promise((resolve) => {
    releaseUsers = resolve;
  });
  let userStarted = 0;

  await withApi(async (base, calls) => {
    const cookie = expiredCookie();
    const first = fetch(`${base}/api/auth/me`, { headers: { cookie } });
    const second = fetch(`${base}/api/auth/me`, { headers: { cookie } });
    await new Promise((resolve, reject) => {
      const start = Date.now();
      const timer = setInterval(() => {
        if (userStarted === 2) {
          clearInterval(timer);
          resolve();
        } else if (Date.now() - start > 2000) {
          clearInterval(timer);
          reject(new Error("timed out waiting for both user lookups"));
        }
      }, 10);
    });
    releaseUsers();
    await new Promise((resolve, reject) => {
      const start = Date.now();
      const timer = setInterval(() => {
        const refreshes = calls.filter((call) => call.pathname === "/auth/v1/token").length;
        if (refreshes === 1) {
          clearInterval(timer);
          resolve();
        } else if (Date.now() - start > 2000) {
          clearInterval(timer);
          reject(new Error("timed out waiting for the shared refresh"));
        }
      }, 10);
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls.filter((call) => call.pathname === "/auth/v1/token").length, 1);
    releaseRefresh();
    const [left, right] = await Promise.all([first, second]);
    assert.equal(left.status, 200);
    assert.equal(right.status, 200);
    assert.equal(calls.filter((call) => call.pathname === "/auth/v1/token").length, 1);
    assert.deepEqual(readSignedSession(left.headers.getSetCookie()[0]), readSignedSession(right.headers.getSetCookie()[0]));
  }, {
    onRefresh: () => refreshGate,
    onUser: async () => {
      userStarted += 1;
      if (userStarted === 2) releaseUsers();
      await usersGate;
    },
  });
});
