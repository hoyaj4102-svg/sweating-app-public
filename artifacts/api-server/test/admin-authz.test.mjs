import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { once } from "node:events";
import http from "node:http";
import { register } from "node:module";
import test from "node:test";

register(new URL("./resolve-ts.mjs", import.meta.url), import.meta.url);

const {
  ADMIN_CLASS_INPUT_ERROR,
  ADMIN_GYM_INPUT_ERROR,
  ADMIN_ID_ERROR,
  COMPLETED_STATUS_ERROR,
  parseAdminClassWrite,
  parseAdminGymWrite,
  parseClassId,
} = await import("../src/lib/admin-input.ts");
const { PROFILE_INPUT_ERROR, PROFILE_IS_ADMIN_ERROR, parseProfileWrite } = await import("../src/lib/profile-input.ts");
const { AGE_BAND_ERROR, birthYearBounds } = await import("../src/lib/age-band.ts");
const memberBirthYear = birthYearBounds().max - 5;

const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const gymId = "10000000-0000-4000-8000-000000000001";
const classId = "20000000-0000-4000-8000-000000000001";

const validClass = {
  gym_id: gymId,
  title: "선셋 러닝",
  sport_type: "러닝",
  description: null,
  scheduled_at: "2026-12-01T10:00:00.000Z",
  duration_minutes: 60,
  capacity: 8,
  price: 0,
  image_url: null,
  status: "published",
  age_band: "20_25",
};

const validGym = {
  name: "웨이브",
  description: null,
  address: "예시시",
  city: "예시시",
  latitude: null,
  longitude: null,
  image_url: null,
};

const validProfile = {
  display_name: "참가자",
  birth_year: memberBirthYear,
  age_preference: "both",
  gender: null,
  profile_photo_url: "https://example.com/a.png",
  sports: ["러닝"],
  interests: [],
  bio: null,
};

test("admin class and gym parsers reject extra fields, completed status, and bad ids", () => {
  const written = parseAdminClassWrite(validClass);
  assert.equal(written.ok, true);
  if (written.ok) {
    assert.equal(written.value.status, "published");
    assert.equal(written.value.scheduled_at, "2026-12-01T10:00:00.000Z");
    assert.deepEqual(Object.keys(written.value).sort(), [
      "age_band",
      "capacity",
      "description",
      "duration_minutes",
      "gym_id",
      "image_url",
      "price",
      "scheduled_at",
      "sport_type",
      "status",
      "title",
    ]);
  }

  assert.deepEqual(parseAdminClassWrite({ ...validClass, status: "completed" }), {
    ok: false,
    error: COMPLETED_STATUS_ERROR,
  });
  assert.deepEqual(parseAdminClassWrite({ ...validClass, id: classId, is_admin: true }), {
    ok: false,
    error: ADMIN_CLASS_INPUT_ERROR,
  });
  assert.deepEqual(parseAdminClassWrite({ ...validClass, capacity: 0, price: -1 }), {
    ok: false,
    error: ADMIN_CLASS_INPUT_ERROR,
  });
  assert.deepEqual(parseAdminClassWrite({ ...validClass, title: "x".repeat(121) }), {
    ok: false,
    error: ADMIN_CLASS_INPUT_ERROR,
  });

  const gym = parseAdminGymWrite(validGym);
  assert.equal(gym.ok, true);
  assert.deepEqual(parseAdminGymWrite({ ...validGym, created_at: "2026-01-01" }), {
    ok: false,
    error: ADMIN_GYM_INPUT_ERROR,
  });
  assert.deepEqual(parseAdminGymWrite({ ...validGym, latitude: 91 }), {
    ok: false,
    error: ADMIN_GYM_INPUT_ERROR,
  });
  assert.deepEqual(parseClassId("not-a-uuid"), { ok: false, error: ADMIN_ID_ERROR });
  assert.equal(parseClassId(classId).ok, true);
});

test("profile parser rejects is_admin and keeps the saved column set", () => {
  const written = parseProfileWrite(validProfile);
  assert.equal(written.ok, true);
  const { age_preference: _keptPreference, ...profileWithoutPreference } = validProfile;
  if (written.ok) {
    assert.equal("is_admin" in written.value, false);
    assert.equal(written.value.age_preference, "both");
    assert.deepEqual(written.value, validProfile);
  }
  assert.equal(parseProfileWrite(profileWithoutPreference).ok, true);
  const omitted = parseProfileWrite(profileWithoutPreference);
  if (omitted.ok) assert.equal("age_preference" in omitted.value, false);
  assert.deepEqual(parseProfileWrite({ ...validProfile, is_admin: true }), {
    ok: false,
    error: PROFILE_IS_ADMIN_ERROR,
  });
  assert.deepEqual(parseProfileWrite({ ...validProfile, id: userId }), {
    ok: false,
    error: PROFILE_INPUT_ERROR,
  });
  assert.deepEqual(parseProfileWrite({ ...validProfile, display_name: "x".repeat(41) }), {
    ok: false,
    error: PROFILE_INPUT_ERROR,
  });
  assert.deepEqual(parseProfileWrite({ ...validProfile, birth_year: 1899 }), {
    ok: false,
    error: PROFILE_INPUT_ERROR,
  });
  assert.deepEqual(parseProfileWrite({ ...validProfile, birth_year: birthYearBounds().max + 1 }), {
    ok: false,
    error: AGE_BAND_ERROR,
  });
  const { birth_year: _ignored, ...withoutBirthYear } = validProfile;
  assert.equal(parseProfileWrite(withoutBirthYear).ok, false);
});

process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "test-only-session-secret";
process.env.SUPABASE_URL = "http://127.0.0.1:9";
process.env.SUPABASE_ANON_KEY = "test-anon";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service";

const { default: app } = await import("../src/app.ts");

function signedSession() {
  const value = JSON.stringify({
    accessToken: "user-access-token",
    user: { id: userId, email: "user@example.com" },
  });
  const signature = createHmac("sha256", process.env.SESSION_SECRET)
    .update(value)
    .digest("base64")
    .replace(/=+$/, "");
  return `swetin_session=${encodeURIComponent(`s:${value}.${signature}`)}`;
}

function installFetch(isAdmin) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const href = String(url);
    const headers = new Headers(init.headers);
    calls.push({
      href,
      method: init.method ?? "GET",
      body: typeof init.body === "string" ? init.body : "",
      authorization: headers.get("authorization"),
    });
    if (href.endsWith("/auth/v1/user")) {
      return Response.json({ id: userId, email: "user@example.com" });
    }
    if (href.includes("/rpc/current_consents_complete")) {
      return Response.json(true);
    }
    if (href.includes("/rest/v1/profiles")) {
      return Response.json([{ id: userId, is_admin: isAdmin }]);
    }
    if (href.includes("/rest/v1/gyms") || href.includes("/rest/v1/classes")) {
      return Response.json([{ id: gymId }]);
    }
    return Response.json({ message: "unexpected" }, { status: 500 });
  };
  return calls;
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

function writes(calls) {
  return calls.filter((call) => (
    call.method !== "GET"
    && !call.href.endsWith("/auth/v1/user")
    && !call.href.includes("/rpc/current_consents_complete")
  ));
}

test("admin routes require an admin and forward only validated writes", async () => {
  let calls = installFetch(true);
  const anonymous = await request("POST", "/api/admin/classes", { body: validClass });
  assert.equal(anonymous.status, 401);
  assert.deepEqual(writes(calls), []);

  calls = installFetch(false);
  const member = await request("POST", "/api/admin/classes", {
    cookie: signedSession(),
    body: validClass,
  });
  assert.equal(member.status, 403);
  assert.deepEqual(writes(calls), []);

  calls = installFetch(true);
  const invalid = await request("POST", "/api/admin/classes", {
    cookie: signedSession(),
    body: { ...validClass, is_admin: true },
  });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.error, ADMIN_CLASS_INPUT_ERROR);
  assert.deepEqual(writes(calls), []);

  calls = installFetch(true);
  const completed = await request("PATCH", `/api/admin/classes/${classId}`, {
    cookie: signedSession(),
    body: { ...validClass, status: "completed" },
  });
  assert.equal(completed.status, 400);
  assert.equal(completed.body.error, COMPLETED_STATUS_ERROR);
  assert.deepEqual(writes(calls), []);

  calls = installFetch(true);
  const badId = await request("PATCH", "/api/admin/classes/not-a-uuid/complete", {
    cookie: signedSession(),
  });
  assert.equal(badId.status, 400);
  assert.equal(badId.body.error, ADMIN_ID_ERROR);
  assert.deepEqual(writes(calls), []);

  calls = installFetch(true);
  const created = await request("POST", "/api/admin/classes", {
    cookie: signedSession(),
    body: validClass,
  });
  assert.equal(created.status, 201);
  const classWrite = writes(calls);
  assert.equal(classWrite.length, 1);
  assert.equal(classWrite[0].authorization, "Bearer test-service");
  assert.deepEqual(JSON.parse(classWrite[0].body), validClass);

  calls = installFetch(true);
  const gym = await request("POST", "/api/admin/gyms", {
    cookie: signedSession(),
    body: validGym,
  });
  assert.equal(gym.status, 201);
  const gymWrite = writes(calls);
  assert.equal(gymWrite.length, 1);
  assert.equal(gymWrite[0].authorization, "Bearer user-access-token");
  assert.deepEqual(JSON.parse(gymWrite[0].body), validGym);

  calls = installFetch(true);
  const escalated = await request("PUT", "/api/profiles/me", {
    cookie: signedSession(),
    body: { ...validProfile, is_admin: true },
  });
  assert.equal(escalated.status, 400);
  assert.equal(escalated.body.error, PROFILE_IS_ADMIN_ERROR);
  assert.deepEqual(writes(calls), []);

  calls = installFetch(true);
  const profile = await request("PUT", "/api/profiles/me", {
    cookie: signedSession(),
    body: validProfile,
  });
  assert.equal(profile.status, 200);
  const profileWrite = writes(calls);
  assert.equal(profileWrite.length, 1);
  assert.equal(profileWrite[0].method, "PATCH");
  assert.equal(profileWrite[0].authorization, "Bearer user-access-token");
  assert.match(profileWrite[0].href, new RegExp(`/rest/v1/profiles\\?id=eq\\.${userId}$`));
  const saved = JSON.parse(profileWrite[0].body);
  assert.equal(Object.hasOwn(saved, "id"), false);
  assert.equal(Object.hasOwn(saved, "is_admin"), false);
  assert.equal(saved.display_name, validProfile.display_name);
});
