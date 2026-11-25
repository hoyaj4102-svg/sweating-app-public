import assert from "node:assert/strict";
import { ageBandForBirthYear, birthYearBounds } from "../src/lib/age-band.ts";

const MEMBER_BIRTH_YEAR = birthYearBounds().max - 5;
const MEMBER_BAND = ageBandForBirthYear(MEMBER_BIRTH_YEAR);
import { createServer, type Server } from "node:http";
import test from "node:test";

const CLASS_ID = "33333333-3333-4333-8333-333333333331";
const GYM_ID = "44444444-4444-4444-8444-444444444441";
const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const USER_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const STRANGER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const CANCELLED_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const ANON = "test-anon-key";
const SERVICE = "test-service-role-key";
const CAPACITY = 2;

const USERS: Record<string, { id: string; email: string; token: string }> = {
  "seat-a@example.test": { id: USER_A, email: "seat-a@example.test", token: "token-a" },
  "seat-b@example.test": { id: USER_B, email: "seat-b@example.test", token: "token-b" },
  "seat-c@example.test": { id: USER_C, email: "seat-c@example.test", token: "token-c" },
};

type Seat = {
  id: string;
  user_id: string;
  attendance_status: string;
  joined_at: string;
};

type Call = {
  method: string;
  pathname: string;
  apikey: string;
  authorization: string;
  body: string | null;
};

const calls: Call[] = [];
let seats: Seat[] = [];
let seatSeq = 0;

function resetSeats(): void {
  calls.length = 0;
  seatSeq = 0;
  seats = [{
    id: CANCELLED_ID,
    user_id: STRANGER,
    attendance_status: "cancelled",
    joined_at: "2026-11-01T00:00:00.000Z",
  }];
}

function occupied(): number {
  return seats.filter((seat) => seat.attendance_status === "registered" || seat.attendance_status === "attended").length;
}

function userForToken(authorization: string): string | null {
  const token = authorization.replace(/^Bearer /, "");
  return Object.values(USERS).find((user) => user.token === token)?.id ?? null;
}

function seatRow(seat: Seat) {
  return {
    id: seat.id,
    class_id: CLASS_ID,
    user_id: seat.user_id,
    payment_status: "free",
    attendance_status: seat.attendance_status,
    joined_at: seat.joined_at,
  };
}

function json(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function installFetch(): void {
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.origin !== "https://example.test") return originalFetch(input, init);
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = new Headers(init?.headers);
    const body = typeof init?.body === "string" ? init.body : null;
    const call: Call = {
      method,
      pathname: url.pathname,
      apikey: headers.get("apikey") ?? "",
      authorization: headers.get("authorization") ?? "",
      body,
    };
    calls.push(call);

    if (url.pathname === "/auth/v1/token") {
      const parsed = body ? JSON.parse(body) as { email?: string } : {};
      const user = parsed.email ? USERS[parsed.email] : undefined;
      if (!user) return json(400, { message: "invalid_grant" });
      return json(200, {
        access_token: user.token,
        refresh_token: `refresh-${user.token}`,
        user: { id: user.id, email: user.email },
      });
    }

    if (url.pathname === "/auth/v1/user") {
      const userId = userForToken(call.authorization);
      const user = Object.values(USERS).find((item) => item.id === userId);
      if (!user) return json(401, { message: "unauthorized" });
      return json(200, { id: user.id, email: user.email });
    }

    if (url.pathname === "/rest/v1/rpc/current_consents_complete") return json(200, true);

    if (url.pathname === "/rest/v1/profiles") {
      const id = url.searchParams.get("id")?.replace(/^eq\./, "") ?? "";
      const user = Object.values(USERS).find((item) => item.id === id);
      if (!user) return json(200, []);
      return json(200, [{
        id: user.id,
        display_name: user.email,
        birth_year: MEMBER_BIRTH_YEAR,
        age_preference: "both",
        gender: null,
        profile_photo_url: "",
        sports: [],
        interests: [],
        bio: null,
        is_admin: false,
        created_at: "2026-11-01T00:00:00.000Z",
        updated_at: "2026-11-01T00:00:00.000Z",
      }]);
    }

    if (url.pathname === "/rest/v1/classes") {
      const scheduledAt = "2027-06-06T01:00:00.000Z";
      const row = {
        id: CLASS_ID,
        gym_id: GYM_ID,
        title: "Seat class",
        sport_type: "러닝",
        description: null,
        scheduled_at: scheduledAt,
        duration_minutes: 60,
        capacity: CAPACITY,
        price: 0,
        image_url: null,
        age_band: MEMBER_BAND,
        status: "published",
        created_at: "2026-11-01T00:00:00.000Z",
        gyms: {
          id: GYM_ID,
          name: "Seat Gym",
          description: null,
          address: "Busan",
          city: "Busan",
          latitude: null,
          longitude: null,
          image_url: null,
          created_at: "2026-11-01T00:00:00.000Z",
        },
      };
      const idParam = url.searchParams.get("id");
      const ids = idParam?.startsWith("eq.")
        ? [idParam.slice(3)]
        : idParam?.startsWith("in.(")
          ? idParam.slice(4, -1).split(",")
          : null;
      if (ids && !ids.includes(CLASS_ID)) return json(200, []);
      const status = url.searchParams.get("status");
      if (status?.startsWith("eq.") && row.status !== status.slice(3)) return json(200, []);
      return json(200, [row]);
    }

    if (url.pathname === "/rest/v1/class_participants" && method === "GET") {
      // Caller tokens only see their own rows. The service role sees every row.
      // A cancelled row is included unless the query excludes it.
      let rows = seats.map(seatRow);
      if (call.authorization === `Bearer ${SERVICE}`) {
        // full table
      } else {
        const userId = userForToken(call.authorization);
        rows = userId ? rows.filter((row) => row.user_id === userId) : [];
      }
      const classFilter = url.searchParams.get("class_id") ?? "";
      if (classFilter && !classFilter.includes(CLASS_ID)) rows = [];
      const userFilter = url.searchParams.get("user_id")?.replace(/^eq\./, "");
      if (userFilter) rows = rows.filter((row) => row.user_id === userFilter);
      if (url.searchParams.get("attendance_status") === "neq.cancelled") {
        rows = rows.filter((row) => row.attendance_status !== "cancelled");
      }
      return json(200, rows);
    }

    if (url.pathname === "/rest/v1/rpc/join_class") {
      if (call.apikey !== SERVICE) return json(401, { message: "service_role required" });
      const parsed = JSON.parse(body ?? "{}") as { p_user_id?: string };
      const userId = parsed.p_user_id ?? "";
      const existing = seats.find((seat) => seat.user_id === userId);
      if (existing && existing.attendance_status !== "cancelled") {
        return json(409, { message: "already_joined" });
      }
      if (occupied() >= CAPACITY) return json(409, { message: "class_full" });
      if (existing) {
        existing.attendance_status = "registered";
        existing.joined_at = "2027-01-02T00:00:00.000Z";
        return json(200, [seatRow(existing)]);
      }
      seatSeq += 1;
      const created: Seat = {
        id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(seatSeq).padStart(12, "0")}`,
        user_id: userId,
        attendance_status: "registered",
        joined_at: "2027-01-01T00:00:00.000Z",
      };
      seats.push(created);
      return json(200, [seatRow(created)]);
    }

    if (url.pathname === "/rest/v1/rpc/cancel_class_seat") {
      if (call.apikey !== SERVICE) return json(401, { message: "service_role required" });
      const parsed = JSON.parse(body ?? "{}") as { p_user_id?: string };
      const existing = seats.find((seat) => seat.user_id === parsed.p_user_id);
      if (!existing) return json(400, { message: "not_joined" });
      if (existing.attendance_status === "cancelled") return json(200, [seatRow(existing)]);
      if (existing.attendance_status !== "registered") return json(400, { message: "seat_not_cancellable" });
      existing.attendance_status = "cancelled";
      return json(200, [seatRow(existing)]);
    }

    if (url.pathname === "/rest/v1/rpc/class_seat_counts") {
      if (call.apikey !== SERVICE || call.authorization !== `Bearer ${SERVICE}`) {
        return json(401, { message: "service_role required" });
      }
      const parsed = JSON.parse(body ?? "{}") as { p_class_ids?: string[]; p_user_id?: string | null };
      const userId = parsed.p_user_id ?? null;
      return json(200, (parsed.p_class_ids ?? []).map((classId) => ({
        class_id: classId,
        occupied: classId === CLASS_ID ? occupied() : 0,
        is_joined: classId === CLASS_ID && seats.some((seat) => seat.user_id === userId && seat.attendance_status !== "cancelled"),
      })));
    }

    throw new Error(`Unexpected Supabase request ${method} ${url.pathname}`);
  };
}

function cookieHeader(response: Response): string {
  return response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
}

type SeatBody = {
  id: string;
  remaining_slots: number;
  participant_count: number;
  is_joined: boolean;
  capacity: number;
};

async function login(base: string, email: string): Promise<string> {
  const response = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "password12" }),
  });
  assert.equal(response.status, 200, `login ${email}`);
  return cookieHeader(response);
}

async function expectSeats(
  base: string,
  cookie: string | undefined,
  expected: { remaining: number; joined: boolean },
  label: string,
  countKey = true,
): Promise<void> {
  calls.length = 0;
  const headers = cookie ? { cookie } : undefined;
  const listResponse = await fetch(`${base}/api/classes`, { headers });
  assert.equal(listResponse.status, 200, `${label} list status`);
  const list = await listResponse.json() as SeatBody[];
  const fromList = list.find((item) => item.id === CLASS_ID);
  assert.ok(fromList, `${label} missing from the list`);
  const detailResponse = await fetch(`${base}/api/classes/${CLASS_ID}`, { headers });
  assert.equal(detailResponse.status, 200, `${label} detail status`);
  const detail = await detailResponse.json() as SeatBody;
  assert.equal(detail.remaining_slots, fromList.remaining_slots, `${label} list/detail remaining`);
  assert.equal(detail.participant_count, fromList.participant_count, `${label} list/detail count`);
  assert.equal(detail.is_joined, fromList.is_joined, `${label} list/detail joined`);
  assert.equal(detail.remaining_slots, expected.remaining, `${label} remaining`);
  assert.equal(detail.participant_count, CAPACITY - expected.remaining, `${label} participant_count`);
  assert.equal(detail.is_joined, expected.joined, `${label} is_joined`);
  assert.equal(detail.participant_count + detail.remaining_slots, detail.capacity, `${label} capacity`);

  if (countKey) {
    const counted = calls.filter((call) =>
      call.pathname === "/rest/v1/rpc/class_seat_counts"
      || (call.pathname === "/rest/v1/class_participants" && call.method === "GET"));
    assert.ok(counted.length > 0, `${label} did not count seats`);
    for (const call of counted) {
      assert.equal(call.apikey, SERVICE, `${label} counted seats with the caller key`);
      assert.equal(call.authorization, `Bearer ${SERVICE}`, `${label} counted seats with the caller token`);
    }
  }
  const classRead = calls.find((call) => call.pathname === "/rest/v1/classes");
  assert.ok(classRead, `${label} did not read the class`);
  assert.notEqual(classRead.apikey, SERVICE, `${label} read the class row with the service role`);
}

async function join(base: string, cookie: string, body?: unknown): Promise<Response> {
  return fetch(`${base}/api/classes/${CLASS_ID}/participants`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
}

async function cancel(base: string, cookie: string, body?: unknown): Promise<Response> {
  return fetch(`${base}/api/classes/${CLASS_ID}/participants`, {
    method: "DELETE",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
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
  installFetch();
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
  resetSeats();
});

test("remaining seats follow join, double join, cancel, and rejoin", async () => {
  const cookieA = await login(base, "seat-a@example.test");
  const cookieB = await login(base, "seat-b@example.test");
  const cookieC = await login(base, "seat-c@example.test");

  await expectSeats(base, undefined, { remaining: CAPACITY, joined: false }, "anon before join", false);
  await expectSeats(base, cookieA, { remaining: CAPACITY, joined: false }, "A before join", false);

  calls.length = 0;
  const first = await join(base, cookieA, { p_user_id: USER_B });
  assert.equal(first.status, 201);
  const firstBody = await first.json() as { id: string; user_id: string; attendance_status: string };
  assert.equal(firstBody.user_id, USER_A);
  assert.equal(firstBody.attendance_status, "registered");
  const joinCall = calls.find((call) => call.pathname === "/rest/v1/rpc/join_class");
  assert.ok(joinCall);
  assert.equal(joinCall.apikey, SERVICE);
  assert.deepEqual(JSON.parse(joinCall.body ?? "{}"), { p_class_id: CLASS_ID, p_user_id: USER_A });

  await expectSeats(base, undefined, { remaining: 1, joined: false }, "anon after one join");
  await expectSeats(base, cookieA, { remaining: 1, joined: true }, "A after one join");
  await expectSeats(base, cookieB, { remaining: 1, joined: false }, "B after A's join");

  const duplicate = await join(base, cookieA);
  assert.equal(duplicate.status, 409);
  const duplicateBody = await duplicate.json() as { error: string };
  assert.match(duplicateBody.error, /already_joined/);
  await expectSeats(base, undefined, { remaining: 1, joined: false }, "anon after double join");
  assert.equal(seats.filter((seat) => seat.user_id === USER_A).length, 1);

  const second = await join(base, cookieB);
  assert.equal(second.status, 201);
  await expectSeats(base, undefined, { remaining: 0, joined: false }, "anon when full");
  await expectSeats(base, cookieA, { remaining: 0, joined: true }, "A when full");
  await expectSeats(base, cookieB, { remaining: 0, joined: true }, "B when full");

  const blocked = await join(base, cookieC);
  assert.equal(blocked.status, 409);
  const blockedBody = await blocked.json() as { error: string };
  assert.match(blockedBody.error, /class_full/);
  await expectSeats(base, cookieC, { remaining: 0, joined: false }, "C rejected");

  calls.length = 0;
  const freed = await cancel(base, cookieA, { p_user_id: USER_B });
  assert.equal(freed.status, 200);
  const freedBody = await freed.json() as { id: string; user_id: string; attendance_status: string };
  assert.equal(freedBody.id, firstBody.id);
  assert.equal(freedBody.user_id, USER_A);
  assert.equal(freedBody.attendance_status, "cancelled");
  const cancelCall = calls.find((call) => call.pathname === "/rest/v1/rpc/cancel_class_seat");
  assert.ok(cancelCall);
  assert.equal(cancelCall.apikey, SERVICE);
  assert.deepEqual(JSON.parse(cancelCall.body ?? "{}"), { p_class_id: CLASS_ID, p_user_id: USER_A });

  await expectSeats(base, undefined, { remaining: 1, joined: false }, "anon after cancel");
  await expectSeats(base, cookieA, { remaining: 1, joined: false }, "A after cancel");
  await expectSeats(base, cookieB, { remaining: 1, joined: true }, "B after A's cancel");

  const activityA = await fetch(`${base}/api/activity`, { headers: { cookie: cookieA } });
  assert.equal(activityA.status, 200);
  const activityABody = await activityA.json() as { upcoming: Array<{ id: string }>; completed: unknown[] };
  assert.deepEqual(activityABody.completed, []);
  assert.deepEqual(activityABody.upcoming.map((item) => item.id), []);

  const activityB = await fetch(`${base}/api/activity`, { headers: { cookie: cookieB } });
  const activityBBody = await activityB.json() as { upcoming: SeatBody[] };
  assert.equal(activityBBody.upcoming[0]?.id, CLASS_ID);
  assert.equal(activityBBody.upcoming[0]?.remaining_slots, 1);
  assert.equal(activityBBody.upcoming[0]?.is_joined, true);

  const cancelAgain = await cancel(base, cookieA);
  assert.equal(cancelAgain.status, 200);
  const cancelAgainBody = await cancelAgain.json() as { id: string; attendance_status: string };
  assert.equal(cancelAgainBody.id, firstBody.id);
  assert.equal(cancelAgainBody.attendance_status, "cancelled");
  await expectSeats(base, undefined, { remaining: 1, joined: false }, "anon after a second cancel");

  const rejoined = await join(base, cookieA);
  assert.equal(rejoined.status, 201);
  const rejoinedBody = await rejoined.json() as { id: string; attendance_status: string };
  assert.equal(rejoinedBody.id, firstBody.id);
  assert.equal(rejoinedBody.attendance_status, "registered");
  await expectSeats(base, cookieA, { remaining: 0, joined: true }, "A after rejoin");
  await expectSeats(base, cookieB, { remaining: 0, joined: true }, "B after A's rejoin");
  assert.equal(seats.filter((seat) => seat.user_id === USER_A).length, 1);

  const cancelAfterRejoin = await cancel(base, cookieA);
  assert.equal(cancelAfterRejoin.status, 200);
  await expectSeats(base, undefined, { remaining: 1, joined: false }, "anon after cancel following rejoin");
  await expectSeats(base, cookieB, { remaining: 1, joined: true }, "B keeps the seat after A's second cancel");
  await expectSeats(base, cookieA, { remaining: 1, joined: false }, "A is not joined after the second cancel");

  const third = await join(base, cookieC);
  assert.equal(third.status, 201);
  await expectSeats(base, undefined, { remaining: 0, joined: false }, "anon after C takes the freed seat");
  const late = await join(base, cookieA);
  assert.equal(late.status, 409);
  const lateBody = await late.json() as { error: string };
  assert.match(lateBody.error, /class_full/);
  await expectSeats(base, cookieC, { remaining: 0, joined: true }, "C still holds the seat");
  await expectSeats(base, cookieB, { remaining: 0, joined: true }, "B still holds the seat");
  await expectSeats(base, cookieA, { remaining: 0, joined: false }, "A did not take a held seat");
});

test("cancel requires a session", async () => {
  const response = await fetch(`${base}/api/classes/${CLASS_ID}/participants`, { method: "DELETE" });
  assert.equal(response.status, 401);
  assert.equal(calls.some((call) => call.pathname === "/rest/v1/rpc/cancel_class_seat"), false);
});
