import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import http from "node:http";
import { register } from "node:module";
import test from "node:test";

register(new URL("./resolve-ts.mjs", import.meta.url), import.meta.url);

const {
  ATTENDANCE_GRACE_AFTER_END_MS,
  attendanceWindowState,
  isUuid,
  mapAttendanceRpcError,
  mayRecordAttendance,
  recordClassAttendance,
} = await import("../src/lib/attendance.ts");

const NOW = Date.parse("2026-11-04T12:00:00.000Z");
const CLASS_ID = "30000000-0000-4000-8000-000000000010";
const GYM_ID = "10000000-0000-4000-8000-000000000099";
const OWNER = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const ADMIN = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PARTICIPANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function session(id) {
  return {
    accessToken: `token-${id}`,
    user: { id, email: `${id.slice(0, 8)}@example.com` },
  };
}

function hourClass(startIso, status = "published") {
  return {
    id: CLASS_ID,
    gym_id: GYM_ID,
    status,
    scheduled_at: startIso,
    duration_minutes: 60,
  };
}

function installFetch(handler) {
  process.env.SUPABASE_URL = "https://sql-test.invalid";
  process.env.SUPABASE_ANON_KEY = "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  const previous = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const href = String(url);
    const headers = new Headers(init?.headers);
    const call = {
      href,
      method: init?.method ?? "GET",
      authorization: headers.get("authorization"),
      body: init?.body ? JSON.parse(String(init.body)) : null,
    };
    calls.push(call);
    const result = await handler(call);
    return new Response(JSON.stringify(result.body ?? null), {
      status: result.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  };
  return {
    calls,
    restore() {
      globalThis.fetch = previous;
    },
  };
}

function signCookie(value, secret) {
  const digest = createHmac("sha256", secret).update(value).digest("base64").replace(/=+$/, "");
  return `s:${value}.${digest}`;
}

function listen(app) {
  const server = http.createServer(app);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({
        port: typeof address === "object" && address ? address.port : 0,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

function requestAttendance(port, cookie, body) {
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      method: "PATCH",
      path: `/api/admin/classes/${CLASS_ID}/participants/${PARTICIPANT}/attendance`,
      headers: {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(payload),
        ...(cookie ? { cookie } : {}),
      },
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve({
          status: response.statusCode,
          body: text ? JSON.parse(text) : null,
        });
      });
    });
    req.on("error", reject);
    req.end(payload);
  });
}

test("attendance window is open from the start through 24 hours after the end", () => {
  const start = "2026-11-04T10:00:00.000Z";
  const end = Date.parse(start) + 60 * 60 * 1000;
  assert.equal(ATTENDANCE_GRACE_AFTER_END_MS, 24 * 60 * 60 * 1000);
  assert.equal(attendanceWindowState(start, 60, Date.parse(start) - 1), "before_start");
  assert.equal(attendanceWindowState(start, 60, Date.parse(start)), "open");
  assert.equal(attendanceWindowState(start, 60, end), "open");
  assert.equal(attendanceWindowState(start, 60, end + ATTENDANCE_GRACE_AFTER_END_MS), "open");
  assert.equal(attendanceWindowState(start, 60, end + ATTENDANCE_GRACE_AFTER_END_MS + 1), "closed");
  assert.equal(attendanceWindowState("not-a-date", 60, NOW), "invalid");
  assert.equal(attendanceWindowState(start, 0, NOW), "invalid");
});

test("only the gym owner or an admin may record attendance", () => {
  assert.equal(mayRecordAttendance(OWNER, false, OWNER), true);
  assert.equal(mayRecordAttendance(ADMIN, true, OWNER), true);
  assert.equal(mayRecordAttendance(PARTICIPANT, false, OWNER), false);
  assert.equal(mayRecordAttendance(PARTICIPANT, false, null), false);
  assert.equal(mayRecordAttendance("", true, null), false);
  assert.equal(isUuid(CLASS_ID), true);
  assert.equal(isUuid("not-a-uuid"), false);
});

test("rpc attendance errors keep their HTTP status", () => {
  assert.equal(mapAttendanceRpcError("attendance_forbidden").status, 403);
  assert.equal(mapAttendanceRpcError("attendance_too_early").status, 409);
  assert.equal(mapAttendanceRpcError("attendance_window_closed").status, 409);
  assert.equal(mapAttendanceRpcError("attendance_locked").status, 409);
  assert.equal(mapAttendanceRpcError("participant_not_found").status, 404);
  assert.equal(mapAttendanceRpcError("attendance_status_invalid").status, 400);
});

test("a participant cannot mark themselves and the rpc is not called", async () => {
  const fetchMock = installFetch((call) => {
    if (call.href.includes("/rest/v1/profiles")) return { body: [{ is_admin: false }] };
    if (call.href.includes("/rest/v1/classes")) return { body: [hourClass("2026-11-04T11:00:00.000Z")] };
    if (call.href.includes("/rest/v1/gym_owners")) return { body: [{ user_id: OWNER }] };
    return { status: 500, body: { message: `unexpected ${call.href}` } };
  });
  try {
    const result = await recordClassAttendance(session(PARTICIPANT), CLASS_ID, PARTICIPANT, "attended", NOW);
    assert.equal(result.status, 403);
    assert.match(result.body.error, /권한/);
    assert.equal(fetchMock.calls.some((call) => call.href.includes("/rpc/record_attendance")), false);
  } finally {
    fetchMock.restore();
  }
});

test("a non-admin stranger cannot record another participant", async () => {
  const fetchMock = installFetch((call) => {
    if (call.href.includes("/rest/v1/profiles")) return { body: [{ is_admin: false }] };
    if (call.href.includes("/rest/v1/classes")) return { body: [hourClass("2026-11-04T11:00:00.000Z")] };
    if (call.href.includes("/rest/v1/gym_owners")) return { body: [{ user_id: OWNER }] };
    return { status: 500, body: { message: "unexpected" } };
  });
  try {
    const result = await recordClassAttendance(session(OTHER), CLASS_ID, PARTICIPANT, "attended", NOW);
    assert.equal(result.status, 403);
    assert.equal(fetchMock.calls.some((call) => call.href.includes("/rpc/record_attendance")), false);
  } finally {
    fetchMock.restore();
  }
});

test("recording is refused before the start and after the 24 hour window", async () => {
  const cases = [
    { start: "2026-11-04T13:00:00.000Z", status: 409, error: /시작 전/ },
    { start: "2026-11-03T10:00:00.000Z", status: 409, error: /24시간/ },
  ];
  for (const item of cases) {
    const fetchMock = installFetch((call) => {
      if (call.href.includes("/rest/v1/profiles")) return { body: [{ is_admin: true }] };
      if (call.href.includes("/rest/v1/classes")) return { body: [hourClass(item.start)] };
      if (call.href.includes("/rest/v1/gym_owners")) return { body: [] };
      return { status: 500, body: { message: "unexpected" } };
    });
    try {
      const result = await recordClassAttendance(session(ADMIN), CLASS_ID, PARTICIPANT, "no_show", NOW);
      assert.equal(result.status, item.status);
      assert.match(result.body.error, item.error);
      assert.equal(fetchMock.calls.some((call) => call.href.includes("/rpc/record_attendance")), false);
    } finally {
      fetchMock.restore();
    }
  }
});

test("the gym owner and an admin record through the caller's token", async () => {
  const cases = [
    { actor: OWNER, isAdmin: false, status: "attended" },
    { actor: ADMIN, isAdmin: true, status: "no_show" },
  ];
  for (const item of cases) {
    const fetchMock = installFetch((call) => {
      if (call.href.includes("/rest/v1/profiles")) return { body: [{ is_admin: item.isAdmin }] };
      if (call.href.includes("/rest/v1/classes")) return { body: [hourClass("2026-11-04T11:00:00.000Z")] };
      if (call.href.includes("/rest/v1/gym_owners")) {
        assert.equal(call.authorization, "Bearer test-service-role-key");
        return { body: [{ user_id: OWNER }] };
      }
      if (call.href.includes("/rpc/record_attendance")) {
        assert.equal(call.authorization, `Bearer token-${item.actor}`);
        assert.deepEqual(call.body, {
          p_class_id: CLASS_ID,
          p_user_id: PARTICIPANT,
          p_status: item.status,
        });
        return {
          body: {
            id: "40000000-0000-4000-8000-000000000001",
            class_id: CLASS_ID,
            user_id: PARTICIPANT,
            attendance_status: item.status,
          },
        };
      }
      return { status: 500, body: { message: `unexpected ${call.href}` } };
    });
    try {
      const result = await recordClassAttendance(session(item.actor), CLASS_ID, PARTICIPANT, item.status, NOW);
      assert.equal(result.status, 200);
      assert.equal(result.body.attendance_status, item.status);
    } finally {
      fetchMock.restore();
    }
  }
});

test("sql still rejects a caller the api allowed, including a later like lock", async () => {
  const fetchMock = installFetch((call) => {
    if (call.href.includes("/rest/v1/profiles")) return { body: [{ is_admin: true }] };
    if (call.href.includes("/rest/v1/classes")) return { body: [hourClass("2026-11-04T11:00:00.000Z")] };
    if (call.href.includes("/rest/v1/gym_owners")) return { body: [{ user_id: OWNER }] };
    if (call.href.includes("/rpc/record_attendance")) return { status: 400, body: { message: "attendance_locked" } };
    return { status: 500, body: { message: "unexpected" } };
  });
  try {
    const result = await recordClassAttendance(session(ADMIN), CLASS_ID, PARTICIPANT, "attended", NOW);
    assert.equal(result.status, 409);
    assert.match(result.body.error, /관심/);
  } finally {
    fetchMock.restore();
  }
});

test("invalid status, unknown class, and non-uuid ids never become an attendance write", async () => {
  const fetchMock = installFetch((call) => {
    if (call.href.includes("/rest/v1/profiles")) return { body: [{ is_admin: true }] };
    if (call.href.includes("/rest/v1/classes")) return { body: [] };
    if (call.href.includes("/rest/v1/gym_owners")) return { body: [] };
    return { status: 500, body: { message: "unexpected" } };
  });
  try {
    const badStatus = await recordClassAttendance(session(ADMIN), CLASS_ID, PARTICIPANT, "registered", NOW);
    assert.equal(badStatus.status, 400);
    const missing = await recordClassAttendance(session(ADMIN), CLASS_ID, PARTICIPANT, "attended", NOW);
    assert.equal(missing.status, 404);
    const badId = await recordClassAttendance(session(ADMIN), "not-a-uuid", PARTICIPANT, "attended", NOW);
    assert.equal(badId.status, 400);
    assert.equal(fetchMock.calls.some((call) => call.href.includes("/rpc/record_attendance")), false);
    assert.equal(fetchMock.calls.some((call) => call.href.includes("not-a-uuid")), false);
  } finally {
    fetchMock.restore();
  }
});

test("PATCH attendance route requires a session and records for an admin", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousSecret = process.env.SESSION_SECRET;
  process.env.NODE_ENV = "development";
  process.env.SESSION_SECRET = "attendance-test-secret";
  const [{ default: express }, { default: cookieParser }, { default: adminRouter }] = await Promise.all([
    import("express"),
    import("cookie-parser"),
    import("../src/routes/admin.ts"),
  ]);
  const app = express();
  app.use(cookieParser(process.env.SESSION_SECRET));
  app.use(express.json());
  app.use("/api", adminRouter);
  const server = await listen(app);
  const inWindow = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const fetchMock = installFetch((call) => {
    if (call.href.includes("/auth/v1/user")) return { body: { id: ADMIN, email: "admin@example.com" } };
    if (call.href.includes("/rest/v1/profiles")) return { body: [{ is_admin: true }] };
    if (call.href.includes("/rest/v1/classes")) return { body: [hourClass(inWindow)] };
    if (call.href.includes("/rest/v1/gym_owners")) return { body: [{ user_id: OWNER }] };
    if (call.href.includes("/rpc/record_attendance")) {
      return { body: { id: "40000000-0000-4000-8000-000000000001", attendance_status: "attended", user_id: PARTICIPANT, class_id: CLASS_ID } };
    }
    return { status: 500, body: { message: `unexpected ${call.href}` } };
  });
  try {
    const anonymous = await requestAttendance(server.port, undefined, { attendance_status: "attended" });
    assert.equal(anonymous.status, 401);

    const cookie = `swetin_session=${encodeURIComponent(signCookie(JSON.stringify(session(ADMIN)), process.env.SESSION_SECRET))}`;
    const recorded = await requestAttendance(server.port, cookie, { attendance_status: "attended" });
    assert.equal(recorded.status, 200);
    assert.equal(recorded.body.attendance_status, "attended");
    assert.equal(
      fetchMock.calls.some((call) => call.href.includes("/rpc/record_attendance") && call.body.p_status === "attended"),
      true,
    );
  } finally {
    fetchMock.restore();
    await server.close();
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previousSecret;
  }
});
