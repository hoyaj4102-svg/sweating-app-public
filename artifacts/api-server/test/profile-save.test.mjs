import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { once } from "node:events";
import http from "node:http";
import { register } from "node:module";
import { mock } from "node:test";
import test from "node:test";

register(new URL("./resolve-ts.mjs", import.meta.url), import.meta.url);

const { PROFILE_INPUT_ERROR, PROFILE_IS_ADMIN_ERROR } = await import("../src/lib/profile-input.ts");
const { BIRTH_YEAR_LOCKED_ERROR, birthYearBounds } = await import("../src/lib/age-band.ts");
const memberBirthYear = birthYearBounds().max - 5;

const userId = "a5a5a5a5-a5a5-45a5-85a5-a5a5a5a5a5a5";
const otherId = "d5d5d5d5-d5d5-45d5-85d5-d5d5d5d5d5d5";
const accessToken = "user-access-token";

const validProfile = {
  display_name: "참가자",
  birth_year: memberBirthYear,
  gender: null,
  profile_photo_url: "https://example.com/a.png",
  sports: ["러닝"],
  interests: ["커피"],
  bio: null,
};

const editableKeys = [
  "bio",
  "birth_year",
  "display_name",
  "gender",
  "interests",
  "profile_photo_url",
  "sports",
];

process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "test-only-session-secret";
process.env.SUPABASE_URL = "http://127.0.0.1:9";
process.env.SUPABASE_ANON_KEY = "test-anon";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service";

const { default: app } = await import("../src/app.ts");
const { logger } = await import("../src/lib/logger.ts");
const { PROFILE_SAVE_ERROR } = await import("../src/routes/profiles.ts");

function signedSession() {
  const value = JSON.stringify({
    accessToken,
    user: { id: userId, email: "user@example.com" },
  });
  const signature = createHmac("sha256", process.env.SESSION_SECRET)
    .update(value)
    .digest("base64")
    .replace(/=+$/, "");
  return `swetin_session=${encodeURIComponent(`s:${value}.${signature}`)}`;
}

function storedProfile() {
  return {
    id: userId,
    display_name: "이전",
    birth_year: memberBirthYear,
    age_preference: "both",
    gender: null,
    profile_photo_url: "https://example.com/old.png",
    sports: ["러닝"],
    interests: [],
    bio: null,
    is_admin: false,
    created_at: "2026-10-01T00:00:00.000Z",
    updated_at: "2026-10-01T00:00:00.000Z",
  };
}

function installFetch({ profile = "missing", writeError = null } = {}) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const href = String(url);
    const headers = new Headers(init.headers);
    const method = init.method ?? "GET";
    calls.push({
      href,
      method,
      body: typeof init.body === "string" ? init.body : "",
      authorization: headers.get("authorization"),
      apikey: headers.get("apikey"),
      prefer: headers.get("prefer"),
    });
    if (href.includes("/rpc/current_consents_complete")) {
      return Response.json(true);
    }
    if (href.endsWith("/auth/v1/user")) {
      if (headers.get("authorization") !== `Bearer ${accessToken}`) {
        return Response.json({ message: "unauthorized" }, { status: 401 });
      }
      return Response.json({ id: userId, email: "user@example.com" });
    }
    if (!href.includes("/rest/v1/profiles")) {
      return Response.json({ message: "unexpected" }, { status: 500 });
    }
    if (method === "GET") {
      return Response.json(profile === "existing" ? [storedProfile()] : []);
    }
    if (writeError) {
      return Response.json(writeError, { status: 403 });
    }
    const parsed = init.body ? JSON.parse(String(init.body)) : {};
    return Response.json([{ ...storedProfile(), ...parsed, id: userId, is_admin: false }]);
  };
  return calls;
}

function profileWrites(calls) {
  return calls.filter((call) => call.href.includes("/rest/v1/profiles") && call.method !== "GET");
}

async function request(method, path, { cookie, body } = {}) {
  const server = http.createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  try {
    return await new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port,
          path,
          method,
          headers: {
            ...(cookie ? { cookie } : {}),
            ...(body ? { "content-type": "application/json" } : {}),
          },
        },
        (res) => {
          const chunks = [];
          res.on("data", (chunk) => chunks.push(chunk));
          res.on("end", () => {
            const raw = Buffer.concat(chunks).toString("utf8");
            resolve({
              status: res.statusCode,
              body: raw ? JSON.parse(raw) : null,
            });
          });
        },
      );
      req.on("error", reject);
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  } finally {
    server.close();
  }
}

function assertUserToken(call) {
  assert.equal(call.authorization, `Bearer ${accessToken}`);
  assert.equal(call.apikey, "test-anon");
  assert.equal(call.authorization.includes("test-service"), false);
}

test("new user profile insert sets the session id and not is_admin", async () => {
  const calls = installFetch({ profile: "missing" });
  const response = await request("PUT", "/api/profiles/me", {
    cookie: signedSession(),
    body: validProfile,
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.id, userId);
  assert.equal(response.body.is_admin, false);
  assert.equal(response.body.birth_year, memberBirthYear);
  assert.equal(response.body.age_preference, "both");

  const writes = profileWrites(calls);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].method, "POST");
  assert.equal(new URL(writes[0].href).search, "");
  assert.equal(writes[0].prefer, "return=representation");
  assert.equal(writes[0].prefer.includes("merge-duplicates"), false);
  assertUserToken(writes[0]);
  const saved = JSON.parse(writes[0].body);
  assert.deepEqual(Object.keys(saved).sort(), [...editableKeys, "id"].sort());
  assert.equal(saved.id, userId);
  assert.equal(Object.hasOwn(saved, "is_admin"), false);
  assert.equal(saved.display_name, validProfile.display_name);
  assert.equal(saved.birth_year, validProfile.birth_year);
  assert.deepEqual(saved.sports, validProfile.sports);
  assert.equal(saved.bio, null);
  assert.equal(Object.hasOwn(saved, "age_preference"), false);

  const reads = calls.filter((call) => call.method === "GET" && call.href.includes("/rest/v1/profiles"));
  assert.equal(reads.length, 1);
  assert.match(reads[0].href, new RegExp(`id=eq\\.${userId}`));
  assertUserToken(reads[0]);
});

test("existing user profile update omits id and is_admin and filters by the session id", async () => {
  const calls = installFetch({ profile: "existing" });
  const response = await request("PUT", "/api/profiles/me", {
    cookie: signedSession(),
    body: { ...validProfile, display_name: "바뀐 이름", age_preference: "same_band" },
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.display_name, "바뀐 이름");
  assert.equal(response.body.is_admin, false);
  assert.equal(response.body.age_preference, "same_band");

  const writes = profileWrites(calls);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].method, "PATCH");
  assert.equal(new URL(writes[0].href).search, `?id=eq.${userId}`);
  assert.equal(writes[0].prefer.includes("merge-duplicates"), false);
  assertUserToken(writes[0]);
  const saved = JSON.parse(writes[0].body);
  assert.deepEqual(Object.keys(saved).sort(), [...editableKeys, "age_preference"].sort());
  assert.equal(Object.hasOwn(saved, "id"), false);
  assert.equal(Object.hasOwn(saved, "is_admin"), false);
  assert.equal(saved.display_name, "바뀐 이름");
  assert.equal(saved.age_preference, "same_band");
  assert.equal(saved.birth_year, memberBirthYear);
});

test("profile save rejects a body id or is_admin before writing", async () => {
  let calls = installFetch({ profile: "missing" });
  const withId = await request("PUT", "/api/profiles/me", {
    cookie: signedSession(),
    body: { ...validProfile, id: otherId },
  });
  assert.equal(withId.status, 400);
  assert.equal(withId.body.error, PROFILE_INPUT_ERROR);
  assert.deepEqual(profileWrites(calls), []);

  calls = installFetch({ profile: "existing" });
  const withAdmin = await request("PUT", "/api/profiles/me", {
    cookie: signedSession(),
    body: { ...validProfile, is_admin: true },
  });
  assert.equal(withAdmin.status, 400);
  assert.equal(withAdmin.body.error, PROFILE_IS_ADMIN_ERROR);
  assert.deepEqual(profileWrites(calls), []);
  assert.equal(calls.some((call) => call.href.includes("/rest/v1/profiles")), false);
});

test("permission denied returns a generic Korean error and logs no identifiers", async () => {
  const logged = mock.method(logger, "error", () => {});
  try {
    const insertCalls = installFetch({
      profile: "missing",
      writeError: { message: "permission denied for column id" },
    });
    const created = await request("PUT", "/api/profiles/me", {
      cookie: signedSession(),
      body: validProfile,
    });
    assert.equal(created.status, 400);
    assert.deepEqual(created.body, { error: PROFILE_SAVE_ERROR });
    assert.match(created.body.error, /^[가-힣0-9\s.,!?~…·’'()\-]+$/);
    assert.equal(created.body.error.length <= 160, true);
    assert.equal(JSON.stringify(created.body).includes(userId), false);
    assert.equal(JSON.stringify(created.body).includes("permission denied"), false);
    assert.equal(JSON.stringify(created.body).includes(accessToken), false);
    assert.equal(profileWrites(insertCalls).length, 1);
    assert.equal(profileWrites(insertCalls)[0].method, "POST");

    const updateCalls = installFetch({
      profile: "existing",
      writeError: { code: "42501", message: "permission denied for table profiles" },
    });
    const updated = await request("PUT", "/api/profiles/me", {
      cookie: signedSession(),
      body: validProfile,
    });
    assert.equal(updated.status, 400);
    assert.deepEqual(updated.body, { error: PROFILE_SAVE_ERROR });
    assert.equal(profileWrites(updateCalls)[0].method, "PATCH");

    const denials = logged.mock.calls.filter((call) => call.arguments[1] === "profile save rejected by database privileges");
    assert.equal(denials.length, 2);
    assert.deepEqual(denials[0].arguments[0], {});
    assert.deepEqual(denials[1].arguments[0], { code: "42501" });
    for (const call of denials) {
      const line = JSON.stringify(call.arguments);
      assert.equal(line.includes(userId), false);
      assert.equal(line.includes(accessToken), false);
      assert.equal(line.includes("permission denied"), false);
      assert.equal(line.includes("test-anon"), false);
      assert.equal(line.includes("test-service"), false);
    }
  } finally {
    logged.mock.restore();
  }
});

test("birth year lock from the database stays specific and is not logged as a privilege denial", async () => {
  const logged = mock.method(logger, "error", () => {});
  try {
    const calls = installFetch({
      profile: "existing",
      writeError: { code: "42501", message: "birth_year_locked" },
    });
    const response = await request("PUT", "/api/profiles/me", {
      cookie: signedSession(),
      body: validProfile,
    });
    assert.equal(response.status, 400);
    assert.equal(response.body.error, BIRTH_YEAR_LOCKED_ERROR);
    assert.equal(profileWrites(calls).length, 1);
    const denials = logged.mock.calls.filter((call) => String(call.arguments[1]).includes("profile save rejected"));
    assert.deepEqual(denials, []);
  } finally {
    logged.mock.restore();
  }
});
