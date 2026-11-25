import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { once } from "node:events";
import http from "node:http";
import { register } from "node:module";
import test from "node:test";

register(new URL("./resolve-ts.mjs", import.meta.url), import.meta.url);

const {
  ACCOUNT_NOT_FOUND,
  OWNER_EMAIL_ERROR,
  OWNER_EXISTS,
  OWNER_FORBIDDEN,
  GYM_MOVE_ERROR,
  parseOwnerEmail,
  rosterRows,
  withoutPaymentFields,
} = await import("../src/lib/owner-access.ts");

const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const hostId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const gymId = "10000000-0000-4000-8000-000000000001";
const otherGymId = "10000000-0000-4000-8000-000000000002";
const classId = "20000000-0000-4000-8000-000000000001";
const otherClassId = "20000000-0000-4000-8000-000000000002";
const hostEmail = "host@example.com";

const validClass = {
  gym_id: gymId,
  title: "선셋 러닝",
  sport_type: "러닝",
  description: null,
  scheduled_at: "2026-12-01T10:00:00.000Z",
  duration_minutes: 75,
  capacity: 9,
  price: 0,
  image_url: null,
  status: "published",
  age_band: "20_25",
};

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

function installFetch({ isAdmin = false, owned = [], classGym = gymId, ownerUserId = null, lookupId = hostId } = {}) {
  const calls = [];
  let assignedUserId = ownerUserId;
  globalThis.fetch = async (url, init = {}) => {
    const href = String(url);
    const headers = new Headers(init.headers);
    const method = init.method ?? "GET";
    const body = typeof init.body === "string" ? init.body : "";
    calls.push({ href, method, body, authorization: headers.get("authorization") });
    if (href.endsWith("/auth/v1/user")) {
      return Response.json({ id: userId, email: "user@example.com" });
    }
    if (href.includes("/rpc/owned_gym_ids")) return Response.json(owned);
    if (href.includes("/rpc/lookup_user_id_by_email")) return Response.json(lookupId);
    if (href.includes("/rpc/owner_class_roster")) {
      return Response.json([{ id: classId, user_id: hostId, attendance_status: "registered", display_name: "참가자" }]);
    }
    if (href.includes("/rest/v1/profiles")) {
      return Response.json([{ id: userId, is_admin: isAdmin, display_name: "호스트" }]);
    }
    if (href.includes("/rest/v1/gym_owners")) {
      if (method === "POST") assignedUserId = hostId;
      if (method === "GET") return Response.json(assignedUserId ? [{ user_id: assignedUserId }] : []);
      return Response.json([{ gym_id: gymId, user_id: hostId }]);
    }
    if (href.includes("/rest/v1/gyms")) return Response.json([{ id: gymId, name: "Gym", address: "Busan", city: "Busan", created_at: "2026-11-01T00:00:00.000Z" }]);
    if (href.includes("/rest/v1/classes")) {
      if (method === "GET") return Response.json([{ id: classId, gym_id: classGym, status: "published" }]);
      return Response.json([{ id: classId, gym_id: gymId, status: "published" }]);
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
            resolve({ status: res.statusCode, raw, body: raw ? JSON.parse(raw) : null });
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
  return calls.filter((call) => call.method !== "GET" && !call.href.endsWith("/auth/v1/user") && !call.href.includes("/rpc/owned_gym_ids"));
}

test("owner email parser accepts one normalized address and nothing else", () => {
  assert.deepEqual(parseOwnerEmail({ email: "  Host@Example.com " }), { ok: true, value: "host@example.com" });
  assert.deepEqual(parseOwnerEmail({ email: "not-an-email" }), { ok: false, error: OWNER_EMAIL_ERROR });
  assert.deepEqual(parseOwnerEmail({ email: hostEmail, user_id: userId }), { ok: false, error: OWNER_EMAIL_ERROR });
});

test("members cannot reach owner class routes or assign a gym owner", async () => {
  let calls = installFetch();
  const anonymous = await request("POST", "/api/owner/classes", { body: validClass });
  assert.equal(anonymous.status, 401);
  assert.deepEqual(writes(calls), []);

  calls = installFetch({ owned: [] });
  const created = await request("POST", "/api/owner/classes", { cookie: signedSession(), body: validClass });
  assert.equal(created.status, 403);
  assert.equal(created.body.error, OWNER_FORBIDDEN);
  assert.equal(writes(calls).some((call) => call.href.includes("/rest/v1/classes")), false);

  calls = installFetch({ owned: [] });
  const gyms = await request("GET", "/api/owner/gyms", { cookie: signedSession() });
  assert.equal(gyms.status, 403);

  calls = installFetch({ isAdmin: false });
  const assign = await request("POST", `/api/admin/gyms/${gymId}/owner`, {
    cookie: signedSession(),
    body: { email: hostEmail },
  });
  assert.equal(assign.status, 403);
  assert.equal(calls.some((call) => call.href.includes("lookup_user_id_by_email")), false);
});

test("an owner writes only their gym and cannot read another gym's roster", async () => {
  let calls = installFetch({ owned: [gymId] });
  const created = await request("POST", "/api/owner/classes", { cookie: signedSession(), body: validClass });
  assert.equal(created.status, 201);
  const classWrite = writes(calls).find((call) => call.href.includes("/rest/v1/classes"));
  assert.equal(classWrite?.method, "POST");
  assert.equal(classWrite?.authorization, "Bearer user-access-token");
  assert.deepEqual(JSON.parse(classWrite.body), validClass);

  calls = installFetch({ owned: [gymId] });
  const foreign = await request("POST", "/api/owner/classes", {
    cookie: signedSession(),
    body: { ...validClass, gym_id: otherGymId },
  });
  assert.equal(foreign.status, 403);
  assert.equal(writes(calls).some((call) => call.method === "POST" && call.href.includes("/rest/v1/classes")), false);

  calls = installFetch({ owned: [gymId], classGym: otherGymId });
  const moved = await request("PATCH", `/api/owner/classes/${otherClassId}`, {
    cookie: signedSession(),
    body: validClass,
  });
  assert.equal(moved.status, 403);
  assert.equal(writes(calls).some((call) => call.method === "PATCH"), false);

  calls = installFetch({ owned: [gymId], classGym: gymId });
  const gymChange = await request("PATCH", `/api/owner/classes/${classId}`, {
    cookie: signedSession(),
    body: { ...validClass, gym_id: otherGymId },
  });
  assert.equal(gymChange.status, 400);
  assert.equal(gymChange.body.error, GYM_MOVE_ERROR);
  assert.equal(writes(calls).some((call) => call.method === "PATCH" && call.href.includes("/rest/v1/classes")), false);

  calls = installFetch({ owned: [gymId], classGym: otherGymId });
  const roster = await request("GET", `/api/owner/classes/${otherClassId}/participants`, { cookie: signedSession() });
  assert.equal(roster.status, 403);
  assert.equal(calls.some((call) => call.href.includes("owner_class_roster")), false);
});

test("admin owner assignment uses the service role and does not echo the email", async () => {
  let calls = installFetch({ isAdmin: true, ownerUserId: hostId });
  const occupied = await request("POST", `/api/admin/gyms/${gymId}/owner`, {
    cookie: signedSession(),
    body: { email: hostEmail },
  });
  assert.equal(occupied.status, 409);
  assert.equal(occupied.body.error, OWNER_EXISTS);
  assert.equal(calls.some((call) => call.href.includes("lookup_user_id_by_email")), false);
  assert.equal(occupied.raw.includes(hostEmail), false);

  calls = installFetch({ isAdmin: true, lookupId: null });
  const missing = await request("POST", `/api/admin/gyms/${gymId}/owner`, {
    cookie: signedSession(),
    body: { email: hostEmail },
  });
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error, ACCOUNT_NOT_FOUND);
  assert.equal(missing.raw.includes(hostEmail), false);

  calls = installFetch({ isAdmin: true, lookupId: hostId });
  const assigned = await request("POST", `/api/admin/gyms/${gymId}/owner`, {
    cookie: signedSession(),
    body: { email: hostEmail },
  });
  assert.equal(assigned.status, 201);
  assert.equal(assigned.raw.includes(hostEmail), false);
  assert.equal(assigned.body.owner.display_name, "호스트");
  assert.equal(assigned.body.owner.user_id, hostId);
  assert.equal(Object.hasOwn(assigned.body.owner, "email"), false);
  const lookup = calls.find((call) => call.href.includes("lookup_user_id_by_email"));
  assert.equal(lookup?.authorization, "Bearer test-service");
  const insert = calls.find((call) => call.method === "POST" && call.href.includes("/rest/v1/gym_owners"));
  assert.equal(insert?.authorization, "Bearer test-service");
  const inserted = JSON.parse(insert.body);
  assert.equal(inserted.gym_id, gymId);
  assert.equal(inserted.user_id, hostId);
  assert.match(inserted.approved_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  assert.deepEqual(Object.keys(inserted).sort(), ["approved_at", "gym_id", "user_id"]);
  assert.equal(assigned.raw.includes("approved_at"), false);
});

test("owner roster and attendance responses omit payment fields", async () => {
  const leaked = {
    id: classId,
    user_id: hostId,
    attendance_status: "attended",
    display_name: "참가자",
    payment_status: "paid",
    payment_note: "card",
    profile_photo_url: "profile-photos/member/avatar.jpg",
  };
  assert.deepEqual(rosterRows([leaked]), [{
    id: classId,
    user_id: hostId,
    attendance_status: "attended",
    display_name: "참가자",
  }]);
  assert.equal("payment_status" in withoutPaymentFields(leaked), false);
  assert.equal("payment_note" in withoutPaymentFields(leaked), false);
  assert.equal("profile_photo_url" in withoutPaymentFields(leaked), false);

  const started = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const calls = installFetch({ owned: [gymId] });
  const previous = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const href = String(url);
    const headers = new Headers(init.headers);
    const method = init.method ?? "GET";
    calls.push({ href, method, body: typeof init.body === "string" ? init.body : "", authorization: headers.get("authorization") });
    if (href.endsWith("/auth/v1/user")) return Response.json({ id: userId, email: "user@example.com" });
    if (href.includes("/rpc/owned_gym_ids")) return Response.json([gymId]);
    if (href.includes("/rest/v1/profiles")) return Response.json([{ id: userId, is_admin: false }]);
    if (href.includes("/rest/v1/gym_owners")) return Response.json([{ user_id: userId }]);
    if (href.includes("/rest/v1/classes") && href.includes("scheduled_at")) {
      return Response.json([{
        id: classId,
        gym_id: gymId,
        status: "published",
        scheduled_at: started,
        duration_minutes: 60,
      }]);
    }
    if (href.includes("/rest/v1/classes")) return Response.json([{ id: classId, gym_id: gymId, status: "published" }]);
    if (href.includes("/rpc/record_attendance")) {
      return Response.json([{
        id: classId,
        class_id: classId,
        user_id: hostId,
        payment_status: "paid",
        attendance_status: "attended",
        joined_at: "2026-11-01T00:00:00.000Z",
        profile_photo_url: "profile-photos/member/avatar.jpg",
      }]);
    }
    return Response.json({ message: "unexpected" }, { status: 500 });
  };
  try {
    const recorded = await request(
      "PATCH",
      `/api/owner/classes/${classId}/participants/${hostId}/attendance`,
      { cookie: signedSession(), body: { attendance_status: "attended" } },
    );
    assert.equal(recorded.status, 200);
    assert.equal(recorded.raw.includes("payment"), false);
    assert.equal(recorded.raw.includes("paid"), false);
    assert.equal(recorded.raw.includes("profile-photos"), false);
    assert.equal(recorded.raw.includes("profile_photo"), false);
    assert.equal(recorded.body.attendance_status, "attended");
  } finally {
    globalThis.fetch = previous;
  }
});
