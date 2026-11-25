import assert from "node:assert/strict";
import { createServer, request as httpRequest, type Server } from "node:http";
import test from "node:test";
import { ageBandForBirthYear, birthYearBounds } from "../src/lib/age-band.ts";
import { CLASS_STARTED_MESSAGE } from "../src/lib/class-schedule.ts";

const OWN_BIRTH_YEAR = birthYearBounds().max - 5;
const OTHER_BAND_BIRTH_YEAR = birthYearBounds().min + 4;
const OWN_BAND = ageBandForBirthYear(OWN_BIRTH_YEAR);

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const STRANGER = "99999999-9999-4999-8999-999999999999";
const NOSHOW_USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CLASS_ID = "33333333-3333-4333-8333-333333333333";
const PAST_CLASS_ID = "33333333-3333-4333-8333-333333333334";
const GYM_ID = "44444444-4444-4444-8444-444444444444";
const SELF_PARTICIPANT = "55555555-5555-4555-8555-555555555555";
const OTHER_PARTICIPANT = "66666666-6666-4666-8666-666666666666";
const CANCELLED_PARTICIPANT = "77777777-7777-4777-8777-777777777777";
const NOSHOW_PARTICIPANT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MATCH_ID = "88888888-8888-4888-8888-888888888888";
const ACCESS = "user-access-token";
const ANON = "test-anon-key";
const SERVICE = "test-service-role-key";

type Call = {
  method: string;
  pathname: string;
  search: string;
  authorization: string;
  apikey: string;
  body: string | null;
};

type State = {
  classStatus: string;
  scheduledAt: string;
  selfAttendance: string;
  otherAttendance: string;
  isAdmin: boolean;
  omitAdmin: boolean;
  likeError: string | null;
  participants: "roster" | "other-only";
  match: "own" | "foreign";
  birthYears: Record<string, number | null>;
  preferences: Record<string, "same_band" | "both">;
  classAgeBand: string | null;
  extraClasses: Array<{ id: string; scheduled_at: string; title?: string; status?: string }>;
  joinError: string | null;
};

const calls: Call[] = [];
const state: State = {
  classStatus: "published",
  scheduledAt: "2027-06-06T01:00:00.000Z",
  selfAttendance: "registered",
  otherAttendance: "registered",
  isAdmin: false,
  omitAdmin: false,
  likeError: null,
  participants: "roster",
  match: "own",
  birthYears: {},
  preferences: {},
  classAgeBand: OWN_BAND,
  extraClasses: [],
  joinError: null,
};

const gym = {
  id: GYM_ID,
  name: "Sample Gym",
  description: null,
  address: "Busan",
  city: "Busan",
  latitude: null,
  longitude: null,
  image_url: null,
  created_at: "2026-10-01T00:00:00.000Z",
};

function reset() {
  calls.length = 0;
  state.classStatus = "published";
  state.scheduledAt = "2027-06-06T01:00:00.000Z";
  state.selfAttendance = "registered";
  state.otherAttendance = "registered";
  state.isAdmin = false;
  state.omitAdmin = false;
  state.likeError = null;
  state.participants = "roster";
  state.match = "own";
  state.birthYears = {};
  state.preferences = {};
  state.classAgeBand = OWN_BAND;
  state.extraClasses = [];
  state.joinError = null;
}

function classRow() {
  return {
    id: CLASS_ID,
    gym_id: GYM_ID,
    title: "Morning run",
    sport_type: "러닝",
    description: null,
    scheduled_at: state.scheduledAt,
    duration_minutes: 60,
    capacity: 8,
    price: 0,
    image_url: null,
    age_band: state.classAgeBand,
    status: state.classStatus,
    created_at: "2026-10-01T00:00:00.000Z",
    gyms: gym,
  };
}

function allClassRows() {
  return [
    classRow(),
    ...state.extraClasses.map((extra) => ({
      ...classRow(),
      id: extra.id,
      title: extra.title ?? "Past published class",
      scheduled_at: extra.scheduled_at,
      status: extra.status ?? "published",
    })),
  ];
}

function roster() {
  const rows = [
    { id: SELF_PARTICIPANT, user_id: USER, class_id: CLASS_ID, joined_at: "2026-11-01T00:00:00.000Z", attendance_status: state.selfAttendance, payment_status: "free" },
    { id: OTHER_PARTICIPANT, user_id: OTHER, class_id: CLASS_ID, joined_at: "2026-11-01T01:00:00.000Z", attendance_status: state.otherAttendance, payment_status: "free" },
    { id: CANCELLED_PARTICIPANT, user_id: STRANGER, class_id: CLASS_ID, joined_at: "2026-11-01T02:00:00.000Z", attendance_status: "cancelled", payment_status: "free" },
    { id: NOSHOW_PARTICIPANT, user_id: NOSHOW_USER, class_id: CLASS_ID, joined_at: "2026-11-01T03:00:00.000Z", attendance_status: "no_show", payment_status: "free" },
  ];
  if (state.participants === "other-only") return rows.filter((row) => row.user_id === OTHER);
  return rows;
}

function profileFor(id: string) {
  const names: Record<string, string> = {
    [USER]: "Member",
    [OTHER]: "Partner",
    [NOSHOW_USER]: "No Show",
    [STRANGER]: "Stranger",
  };
  const row: Record<string, unknown> = {
    id,
    display_name: names[id] ?? "Member",
    birth_year: id in state.birthYears ? state.birthYears[id] : OWN_BIRTH_YEAR,
    age_preference: state.preferences[id] ?? "both",
    gender: null,
    profile_photo_url: "https://example.test/photo.png",
    sports: ["러닝"],
    interests: ["coffee"],
    bio: null,
    created_at: "2026-10-01T00:00:00.000Z",
    updated_at: "2026-10-01T00:00:00.000Z",
  };
  if (!(id === USER && state.omitAdmin)) row.is_admin = id === USER ? state.isAdmin : false;
  return row;
}

function idsFrom(value: string | null): string[] | null {
  if (!value) return null;
  if (value.startsWith("eq.")) return [decodeURIComponent(value.slice(3))];
  if (value.startsWith("in.(") && value.endsWith(")")) {
    return value.slice(4, -1).split(",").filter(Boolean).map((item) => decodeURIComponent(item));
  }
  return null;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function installFetch() {
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname !== "example.test") return originalFetch(input, init);
    const headers = new Headers(init?.headers);
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? init.body : null;
    const call: Call = {
      method,
      pathname: url.pathname,
      search: url.search,
      authorization: headers.get("authorization") ?? "",
      apikey: headers.get("apikey") ?? "",
      body,
    };
    calls.push(call);

    if (url.pathname === "/auth/v1/signup" || url.pathname === "/auth/v1/token") {
      const parsed = body ? JSON.parse(body) as { email?: string; password?: string } : {};
      if (url.pathname === "/auth/v1/token" && parsed.password === "wrong-password") {
        return json(400, { message: "invalid_grant" });
      }
      return json(200, {
        access_token: ACCESS,
        refresh_token: "refresh-token",
        user: { id: USER, email: parsed.email ?? "member@example.test" },
      });
    }

    if (url.pathname === "/auth/v1/user") {
      if (call.authorization !== `Bearer ${ACCESS}`) return json(401, { message: "unauthorized" });
      return json(200, { id: USER, email: "member@example.test" });
    }

    if (url.pathname === "/auth/v1/logout") return new Response(null, { status: 204 });

    if (url.pathname === "/rest/v1/rpc/current_consents_complete") return json(200, true);

    if (url.pathname === "/rest/v1/profiles") {
      if (method === "POST" || method === "PATCH") {
        const parsed = body ? JSON.parse(body) as { id?: string; birth_year?: number | null; age_preference?: "same_band" | "both" } : {};
        const id = parsed.id ?? USER;
        if (Object.hasOwn(parsed, "birth_year")) state.birthYears[id] = parsed.birth_year ?? null;
        if (parsed.age_preference) state.preferences[id] = parsed.age_preference;
        return json(200, [{ ...profileFor(id), ...parsed, id, is_admin: id === USER ? state.isAdmin : false }]);
      }
      const ids = idsFrom(url.searchParams.get("id")) ?? [USER];
      const select = url.searchParams.get("select") ?? "*";
      return json(200, ids.map((id) => {
        const row = profileFor(id);
        if (select === "*") return row;
        const picked: Record<string, unknown> = {};
        for (const key of select.split(",")) picked[key] = row[key];
        return picked;
      }));
    }

    if (url.pathname === "/rest/v1/classes") {
      let rows = allClassRows();
      const ids = idsFrom(url.searchParams.get("id"));
      if (ids) rows = rows.filter((row) => ids.includes(row.id));
      const status = url.searchParams.get("status");
      if (status?.startsWith("eq.")) rows = rows.filter((row) => row.status === status.slice(3));
      const scheduledAt = url.searchParams.get("scheduled_at");
      if (scheduledAt?.startsWith("gt.")) {
        const cutoff = Date.parse(scheduledAt.slice(3));
        if (!Number.isNaN(cutoff)) rows = rows.filter((row) => Date.parse(row.scheduled_at) > cutoff);
      }
      return json(200, rows);
    }

    if (url.pathname === "/rest/v1/class_participants") {
      let rows = roster();
      const classIds = idsFrom(url.searchParams.get("class_id"));
      if (classIds) rows = rows.filter((row) => classIds.includes(row.class_id));
      const userIds = idsFrom(url.searchParams.get("user_id"));
      if (userIds) rows = rows.filter((row) => userIds.includes(row.user_id));
      const ids = idsFrom(url.searchParams.get("id"));
      if (ids) rows = rows.filter((row) => ids.includes(row.id));
      if (url.searchParams.get("attendance_status") === "neq.cancelled") {
        rows = rows.filter((row) => row.attendance_status !== "cancelled");
      }
      const select = url.searchParams.get("select") ?? "*";
      if (select !== "*") {
        const keys = select.split(",");
        return json(200, rows.map((row) => {
          const picked: Record<string, unknown> = {};
          for (const key of keys) picked[key] = row[key as keyof typeof row];
          return picked;
        }));
      }
      return json(200, rows);
    }

    if (url.pathname === "/rest/v1/likes") {
      return json(200, [{ from_user_id: USER, to_user_id: OTHER }]);
    }

    if (url.pathname === "/rest/v1/matches") {
      const foreign = state.match === "foreign";
      const row = {
        id: MATCH_ID,
        class_id: CLASS_ID,
        user_a_id: foreign ? OTHER : USER,
        user_b_id: foreign ? STRANGER : OTHER,
        created_at: "2026-11-04T12:00:00.000Z",
      };
      const id = idsFrom(url.searchParams.get("id"));
      if (id && !id.includes(row.id)) return json(200, []);
      const userA = idsFrom(url.searchParams.get("user_a_id"));
      if (userA && !userA.includes(row.user_a_id)) return json(200, []);
      const userB = idsFrom(url.searchParams.get("user_b_id"));
      if (userB && !userB.includes(row.user_b_id)) return json(200, []);
      return json(200, [row]);
    }

    if (url.pathname === "/rest/v1/rpc/join_class") {
      if (state.joinError) return json(400, { message: state.joinError });
      return json(200, [{ id: SELF_PARTICIPANT, class_id: CLASS_ID, user_id: USER, attendance_status: "registered" }]);
    }

    if (url.pathname === "/rest/v1/rpc/class_seat_counts") {
      const parsed = body ? JSON.parse(body) as { p_class_ids?: string[]; p_user_id?: string | null } : {};
      const holding = roster().filter((row) => row.attendance_status === "registered" || row.attendance_status === "attended");
      return json(200, (parsed.p_class_ids ?? []).map((classId) => ({
        class_id: classId,
        occupied: holding.filter((row) => row.class_id === classId).length,
        is_joined: roster().some((row) => row.class_id === classId && row.user_id === parsed.p_user_id && row.attendance_status !== "cancelled"),
      })));
    }

    if (url.pathname === "/rest/v1/rpc/like_participant") {
      if (state.likeError) return json(400, { message: state.likeError });
      return json(200, [{ liked: true, matched: false, match_id: null }]);
    }

    if (url.pathname === "/rest/v1/rpc/complete_class") {
      state.classStatus = "completed";
      return json(200, [{ id: CLASS_ID, status: "completed" }]);
    }

    throw new Error(`Unexpected Supabase request ${method} ${url.pathname}`);
  };
}

function cookieHeader(response: Response): string {
  return response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
}

async function login(base: string): Promise<string> {
  const response = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "member@example.test", password: "password12" }),
  });
  assert.equal(response.status, 200);
  return cookieHeader(response);
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
  reset();
});

test("health check does not call Supabase", async () => {
  const response = await fetch(`${base}/api/healthz`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok", supabase_project_ref: null });
  assert.equal(calls.length, 0);
});

test("health check returns only the project ref and no secrets", async () => {
  const previousUrl = process.env.SUPABASE_URL;
  const previousAnon = process.env.SUPABASE_ANON_KEY;
  const previousService = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = "https://user:service-role-secret@abcdefghijklmnopqrst.supabase.co/rest/v1?apikey=anon-secret";
  process.env.SUPABASE_ANON_KEY = "anon-secret-value";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-secret-value";
  try {
    const response = await fetch(`${base}/api/healthz`);
    const body = await response.json() as { status: string; supabase_project_ref: string | null };
    assert.equal(response.status, 200);
    assert.deepEqual(body, { status: "ok", supabase_project_ref: "abcdefghijklmnopqrst" });
    const encoded = JSON.stringify(body);
    assert.equal(encoded.includes("secret"), false);
    assert.equal(encoded.includes("apikey"), false);
    assert.equal(encoded.includes("supabase.co"), false);
    assert.equal(calls.length, 0);
  } finally {
    process.env.SUPABASE_URL = previousUrl;
    process.env.SUPABASE_ANON_KEY = previousAnon;
    process.env.SUPABASE_SERVICE_ROLE_KEY = previousService;
  }
});

test("anonymous session is rejected before Supabase", async () => {
  const response = await fetch(`${base}/api/auth/me`);
  assert.equal(response.status, 401);
  assert.equal(calls.some((call) => call.pathname === "/auth/v1/user"), false);
});

test("email signup, session, and logout stay on the same origin cookie", async () => {
  const signup = await fetch(`${base}/api/auth/signup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "member@example.test", password: "password12" }),
  });
  assert.equal(signup.status, 201);
  const cookie = cookieHeader(signup);
  assert.match(cookie, /swetin_session=/);
  const body = await signup.json() as { user: { id: string }; profile: { is_admin: boolean } | null };
  assert.equal(body.user.id, USER);
  assert.equal(body.profile?.is_admin, false);

  const me = await fetch(`${base}/api/auth/me`, { headers: { cookie } });
  assert.equal(me.status, 200);

  const logout = await fetch(`${base}/api/auth/logout`, { method: "POST", headers: { cookie } });
  assert.equal(logout.status, 204);
  assert.match(logout.headers.getSetCookie().join(";"), /swetin_session=/);
  assert.equal(calls.some((call) => call.pathname === "/auth/v1/logout"), true);
  const meAfter = await fetch(`${base}/api/auth/me`);
  assert.equal(meAfter.status, 401);
});

test("login failure stays 401", async () => {
  const response = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "member@example.test", password: "wrong-password" }),
  });
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "이메일 또는 비밀번호를 확인해 주세요." });
});

test("published class list uses the anon key", async () => {
  const response = await fetch(`${base}/api/classes`);
  assert.equal(response.status, 200);
  const list = calls.find((call) => call.pathname === "/rest/v1/classes");
  assert.ok(list);
  assert.equal(list.authorization, `Bearer ${ANON}`);
  assert.equal(list.apikey, ANON);
  assert.equal(list.apikey === SERVICE, false);
});

test("join_class uses the service role and the session user, not a body user id", async () => {
  const cookie = await login(base);
  calls.length = 0;
  const response = await fetch(`${base}/api/classes/${CLASS_ID}/participants`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ p_user_id: STRANGER }),
  });
  assert.equal(response.status, 201);
  const join = calls.find((call) => call.pathname === "/rest/v1/rpc/join_class");
  assert.ok(join);
  assert.equal(join.apikey, SERVICE);
  assert.equal(join.authorization, `Bearer ${SERVICE}`);
  assert.deepEqual(JSON.parse(join.body ?? "{}"), { p_class_id: CLASS_ID, p_user_id: USER });
});

test("join requires a session", async () => {
  const response = await fetch(`${base}/api/classes/${CLASS_ID}/participants`, { method: "POST" });
  assert.equal(response.status, 401);
  assert.equal(calls.some((call) => call.pathname === "/rest/v1/rpc/join_class"), false);
});

test("attendance stays hidden until the class is completed", async () => {
  const cookie = await login(base);
  calls.length = 0;
  const blind = await fetch(`${base}/api/classes/${CLASS_ID}/blind`, { headers: { cookie } });
  assert.equal(blind.status, 200);
  const body = await blind.json() as {
    is_revealed: boolean;
    is_before_start: boolean;
    participants: unknown[];
    participant_slots: string[];
    participant_count: number;
  };
  assert.equal(body.is_revealed, false);
  assert.equal(body.is_before_start, true);
  assert.deepEqual(body.participants, []);
  assert.equal(body.participant_slots.length, body.participant_count);
  assert.equal(body.participant_count, 3);
  const participantRead = calls.find((call) => call.pathname === "/rest/v1/class_participants");
  assert.ok(participantRead);
  assert.match(participantRead.search, /attendance_status=neq\.cancelled/);
  assert.equal(participantRead.apikey, SERVICE);
});

test("completed attendance reveal excludes the caller, cancelled rows, and anyone not attended", async () => {
  state.classStatus = "completed";
  state.scheduledAt = "2026-10-18T01:00:00.000Z";
  state.selfAttendance = "attended";
  state.otherAttendance = "attended";
  const cookie = await login(base);
  calls.length = 0;
  const response = await fetch(`${base}/api/classes/${CLASS_ID}/revealed-participants`, { headers: { cookie } });
  assert.equal(response.status, 200);
  const body = await response.json() as {
    is_revealed: boolean;
    participants: Array<{ participant_id: string; display_name: string; is_liked: boolean; is_matched: boolean }>;
  };
  assert.equal(body.is_revealed, true);
  const ids = body.participants.map((person) => person.participant_id).sort();
  assert.deepEqual(ids, [OTHER_PARTICIPANT]);
  const partner = body.participants.find((person) => person.participant_id === OTHER_PARTICIPANT);
  assert.equal(partner?.display_name, "Partner");
  assert.equal(partner?.is_liked, true);
  assert.equal(partner?.is_matched, true);
  assert.equal(calls.some((call) => call.pathname.startsWith("/rest/") && call.apikey !== SERVICE), false);
});

test("a non participant cannot read the reveal", async () => {
  state.participants = "other-only";
  state.classStatus = "completed";
  const cookie = await login(base);
  const response = await fetch(`${base}/api/classes/${CLASS_ID}/revealed-participants`, { headers: { cookie } });
  assert.equal(response.status, 403);
});

test("like uses the user token for the RPC and rejects an unfinished class", async () => {
  const cookie = await login(base);
  calls.length = 0;
  const ok = await fetch(`${base}/api/classes/${CLASS_ID}/likes`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ participant_id: OTHER_PARTICIPANT }),
  });
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { liked: true, matched: false, match_id: null });
  const lookup = calls.find((call) => call.pathname === "/rest/v1/class_participants");
  const rpc = calls.find((call) => call.pathname === "/rest/v1/rpc/like_participant");
  assert.equal(lookup?.apikey, SERVICE);
  assert.equal(rpc?.authorization, `Bearer ${ACCESS}`);
  assert.equal(rpc?.apikey, ANON);
  assert.deepEqual(JSON.parse(rpc?.body ?? "{}"), { p_class_id: CLASS_ID, p_to_user_id: OTHER });

  state.likeError = "class_not_completed";
  const blocked = await fetch(`${base}/api/classes/${CLASS_ID}/likes`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ participant_id: OTHER_PARTICIPANT }),
  });
  assert.equal(blocked.status, 403);
});

test("like rejects a participant outside the class", async () => {
  const cookie = await login(base);
  const response = await fetch(`${base}/api/classes/${CLASS_ID}/likes`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ participant_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }),
  });
  assert.equal(response.status, 403);
});

test("match list returns the caller's match and hides a foreign match", async () => {
  const cookie = await login(base);
  const list = await fetch(`${base}/api/matches`, { headers: { cookie } });
  assert.equal(list.status, 200);
  const matches = await list.json() as Array<{ id: string; participant: { display_name: string } }>;
  assert.equal(matches.length, 1);
  assert.equal(matches[0]?.id, MATCH_ID);
  assert.equal(matches[0]?.participant.display_name, "Partner");

  state.match = "foreign";
  const foreign = await fetch(`${base}/api/matches/${MATCH_ID}`, { headers: { cookie } });
  assert.equal(foreign.status, 403);
});

test("admin routes follow the is_admin column on the caller profile", async () => {
  const cookie = await login(base);
  const denied = await fetch(`${base}/api/admin/classes`, { headers: { cookie } });
  assert.equal(denied.status, 403);

  state.omitAdmin = true;
  const missing = await fetch(`${base}/api/admin/classes`, { headers: { cookie } });
  assert.equal(missing.status, 403);
  assert.equal(calls.some((call) => call.search.includes("order=scheduled_at.desc")), false);

  state.omitAdmin = false;
  state.isAdmin = true;
  calls.length = 0;
  const allowed = await fetch(`${base}/api/admin/classes`, { headers: { cookie } });
  assert.equal(allowed.status, 200);
  assert.equal(Array.isArray(await allowed.json()), true);
  const adminRead = calls.find((call) => call.pathname === "/rest/v1/classes");
  assert.equal(adminRead?.authorization, `Bearer ${ACCESS}`);

  const completed = await fetch(`${base}/api/admin/classes/${CLASS_ID}/complete`, {
    method: "PATCH",
    headers: { cookie },
  });
  assert.equal(completed.status, 200);
  const rpc = calls.find((call) => call.pathname === "/rest/v1/rpc/complete_class");
  assert.equal(rpc?.authorization, `Bearer ${ACCESS}`);
  assert.equal(rpc?.apikey, ANON);
});

test("activity lists a future joined class", async () => {
  const cookie = await login(base);
  const response = await fetch(`${base}/api/activity`, { headers: { cookie } });
  assert.equal(response.status, 200);
  const body = await response.json() as { upcoming: Array<{ id: string }>; completed: unknown[] };
  assert.deepEqual(body.completed, []);
  assert.equal(body.upcoming[0]?.id, CLASS_ID);
});

test("OAuth start redirects to Supabase with the same-origin callback", async () => {
  for (const provider of ["kakao", "google"] as const) {
    const target = new URL(`${base}/api/auth/${provider}/start`);
    const response = await new Promise<{ status: number; location: string }>((resolve, reject) => {
      const req = httpRequest(
        { hostname: target.hostname, port: target.port, path: target.pathname, method: "GET" },
        (res) => {
          res.resume();
          const location = res.headers.location;
          resolve({ status: res.statusCode ?? 0, location: Array.isArray(location) ? location[0] ?? "" : location ?? "" });
        },
      );
      req.on("error", reject);
      req.end();
    });
    assert.equal(response.status, 302);
    const location = new URL(response.location);
    assert.equal(location.hostname, "example.test");
    assert.equal(location.pathname, "/auth/v1/authorize");
    assert.equal(location.searchParams.get("provider"), provider);
    assert.equal(location.searchParams.get("flow_type"), "pkce");
    assert.match(location.searchParams.get("redirect_to") ?? "", new RegExp(`/api/auth/${provider}/callback$`));
    assert.equal(location.searchParams.get("state"), null);
    assert.equal(location.searchParams.get("scopes"), null);
  }
});

const profileInput = {
  display_name: "Member",
  birth_year: OWN_BIRTH_YEAR,
  gender: null,
  profile_photo_url: "https://example.test/photo.png",
  sports: ["러닝"],
  interests: ["coffee"],
  bio: null,
};

test("class list shows published bands and join follows the three-band rule", async () => {
  const anon = await fetch(`${base}/api/classes`);
  assert.equal(anon.status, 200);
  const anonCall = calls.find((call) => call.pathname === "/rest/v1/classes");
  assert.doesNotMatch(anonCall?.search ?? "", /age_band=/);
  assert.equal((await anon.json() as Array<{ id: string }>).some((item) => item.id === CLASS_ID), true);

  const cookie = await login(base);
  calls.length = 0;
  const own = await fetch(`${base}/api/classes`, { headers: { cookie } });
  assert.equal(own.status, 200);
  assert.equal((await own.json() as Array<{ id: string }>).some((item) => item.id === CLASS_ID), true);
  const ownCall = calls.find((call) => call.pathname === "/rest/v1/classes");
  assert.doesNotMatch(ownCall?.search ?? "", /age_band=/);

  state.classAgeBand = ageBandForBirthYear(OTHER_BAND_BIRTH_YEAR);
  state.participants = "other-only";
  const shown = await fetch(`${base}/api/classes`, { headers: { cookie } });
  assert.equal((await shown.json() as Array<{ id: string }>).some((item) => item.id === CLASS_ID), true);
  const detail = await fetch(`${base}/api/classes/${CLASS_ID}`, { headers: { cookie } });
  assert.equal(detail.status, 200);

  calls.length = 0;
  const denied = await fetch(`${base}/api/classes/${CLASS_ID}/participants`, {
    method: "POST",
    headers: { cookie },
  });
  assert.equal(denied.status, 403);
  assert.equal(calls.some((call) => call.pathname === "/rest/v1/rpc/join_class"), false);

  state.classAgeBand = "26_35";
  state.preferences[USER] = "same_band";
  const olderOff = await fetch(`${base}/api/classes/${CLASS_ID}/participants`, {
    method: "POST",
    headers: { cookie },
  });
  assert.equal(olderOff.status, 403);

  state.preferences[USER] = "both";
  const olderOn = await fetch(`${base}/api/classes/${CLASS_ID}/participants`, {
    method: "POST",
    headers: { cookie },
  });
  assert.equal(olderOn.status, 201);

  state.classAgeBand = null;
  const unset = await fetch(`${base}/api/classes/${CLASS_ID}/participants`, {
    method: "POST",
    headers: { cookie },
  });
  assert.equal(unset.status, 201);
});

test("legacy same-band preference does not hide or block a cross-band attendee", async () => {
  state.classStatus = "completed";
  state.scheduledAt = "2026-10-18T01:00:00.000Z";
  state.selfAttendance = "attended";
  state.otherAttendance = "attended";
  state.preferences[USER] = "same_band";
  state.preferences[OTHER] = "same_band";
  state.birthYears[OTHER] = OTHER_BAND_BIRTH_YEAR;
  const cookie = await login(base);
  calls.length = 0;
  const shown = await fetch(`${base}/api/classes/${CLASS_ID}/revealed-participants`, { headers: { cookie } });
  assert.equal(shown.status, 200);
  const shownBody = await shown.json() as { is_revealed: boolean; participants: Array<{ participant_id: string }> };
  assert.equal(shownBody.is_revealed, true);
  assert.deepEqual(shownBody.participants.map((person) => person.participant_id), [OTHER_PARTICIPANT]);
  assert.equal(calls.some((call) => call.pathname === "/rest/v1/profiles" && call.search.includes("age_preference")), false);

  const liked = await fetch(`${base}/api/classes/${CLASS_ID}/likes`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ participant_id: OTHER_PARTICIPANT }),
  });
  assert.equal(liked.status, 200);
  assert.equal(calls.some((call) => call.pathname === "/rest/v1/rpc/like_participant"), true);
  const likeReads = calls.filter((call) => call.pathname === "/rest/v1/profiles");
  assert.equal(likeReads.some((call) => call.search.includes("age_preference")), false);

  state.birthYears[OTHER] = null;
  calls.length = 0;
  const missingYear = await fetch(`${base}/api/classes/${CLASS_ID}/revealed-participants`, { headers: { cookie } });
  const missingYearBody = await missingYear.json() as { is_revealed: boolean; participants: Array<{ participant_id: string }> };
  assert.equal(missingYearBody.is_revealed, true);
  assert.deepEqual(missingYearBody.participants.map((person) => person.participant_id), [OTHER_PARTICIPANT]);
  const missingLike = await fetch(`${base}/api/classes/${CLASS_ID}/likes`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ participant_id: OTHER_PARTICIPANT }),
  });
  assert.equal(missingLike.status, 200);
  assert.equal(calls.some((call) => call.pathname === "/rest/v1/rpc/like_participant"), true);

  const olderThanBand = birthYearBounds().min - 1;
  state.birthYears[USER] = olderThanBand;
  state.birthYears[OTHER] = olderThanBand - 8;
  state.preferences[USER] = "same_band";
  state.preferences[OTHER] = "same_band";
  calls.length = 0;
  const older = await fetch(`${base}/api/classes/${CLASS_ID}/revealed-participants`, { headers: { cookie } });
  const olderBody = await older.json() as { is_revealed: boolean; participants: Array<{ participant_id: string }> };
  assert.equal(olderBody.is_revealed, true);
  assert.deepEqual(olderBody.participants.map((person) => person.participant_id), [OTHER_PARTICIPANT]);
  const olderLike = await fetch(`${base}/api/classes/${CLASS_ID}/likes`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ participant_id: OTHER_PARTICIPANT }),
  });
  assert.equal(olderLike.status, 200);
  assert.equal(calls.some((call) => call.pathname === "/rest/v1/rpc/like_participant"), true);
  assert.equal(calls.some((call) => call.pathname === "/rest/v1/profiles" && call.search.includes("age_preference")), false);
  assert.equal(calls.some((call) => call.pathname === "/rest/v1/profiles" && call.search.includes("birth_year")), false);
});

test("birth year is required, must fall in a band, and locks after the first save", async () => {
  const cookie = await login(base);
  state.birthYears[USER] = null;
  calls.length = 0;
  const missing = await fetch(`${base}/api/profiles/me`, {
    method: "PUT",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ ...profileInput, birth_year: undefined }),
  });
  assert.equal(missing.status, 400);

  const tooYoung = await fetch(`${base}/api/profiles/me`, {
    method: "PUT",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ ...profileInput, birth_year: birthYearBounds().max + 1 }),
  });
  assert.equal(tooYoung.status, 400);
  assert.match((await tooYoung.json() as { error: string }).error, /20세부터 45세/);

  const saved = await fetch(`${base}/api/profiles/me`, {
    method: "PUT",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(profileInput),
  });
  assert.equal(saved.status, 200);
  const savedBody = await saved.json() as { birth_year: number; age_band: string; birth_year_locked: boolean; age_preference?: string };
  assert.equal(savedBody.birth_year, OWN_BIRTH_YEAR);
  assert.equal(savedBody.age_band, OWN_BAND);
  assert.equal(savedBody.birth_year_locked, true);
  assert.equal(savedBody.age_preference, "both");

  const kept = await fetch(`${base}/api/profiles/me`, {
    method: "PUT",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ ...profileInput, display_name: "Member Two", age_preference: "same_band" }),
  });
  assert.equal(kept.status, 200);
  assert.equal((await kept.json() as { age_preference?: string }).age_preference, "same_band");
  assert.equal(state.preferences[USER], "same_band");

  const locked = await fetch(`${base}/api/profiles/me`, {
    method: "PUT",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ ...profileInput, birth_year: OTHER_BAND_BIRTH_YEAR }),
  });
  assert.equal(locked.status, 400);
  assert.match((await locked.json() as { error: string }).error, /바꿀 수 없어요/);
  const writes = calls.filter((call) => call.pathname === "/rest/v1/profiles" && (call.method === "POST" || call.method === "PATCH"));
  assert.equal(writes.length, 2);
  assert.equal(writes[0]?.method, "PATCH");
  assert.equal(writes[0]?.search, `?id=eq.${encodeURIComponent(USER)}`);
  const written = JSON.parse(writes[0]?.body ?? "{}") as Record<string, unknown>;
  const rewritten = JSON.parse(writes[1]?.body ?? "{}") as Record<string, unknown>;
  assert.equal(Object.hasOwn(written, "id"), false);
  assert.equal(Object.hasOwn(written, "is_admin"), false);
  assert.equal(Object.hasOwn(written, "age_preference"), false);
  assert.equal(rewritten.age_preference, "same_band");
  assert.equal(written.display_name, profileInput.display_name);
  assert.equal(rewritten.display_name, "Member Two");
  assert.equal(written.birth_year, OWN_BIRTH_YEAR);
});

test("published class list hides past classes and keeps future ones", async () => {
  state.extraClasses = [
    { id: PAST_CLASS_ID, scheduled_at: "2026-11-02T11:00:00.000Z", title: "Already started" },
  ];
  const response = await fetch(`${base}/api/classes`);
  assert.equal(response.status, 200);
  const list = await response.json() as Array<{ id: string }>;
  const ids = list.map((row) => row.id);
  assert.equal(ids.includes(PAST_CLASS_ID), false);
  assert.equal(ids.includes(CLASS_ID), true);
  const query = calls.find((call) => call.pathname === "/rest/v1/classes" && !call.search.includes("id=eq."));
  assert.ok(query);
  assert.match(query.search, /scheduled_at=gt\./);
  assert.match(query.search, /status=eq\.published/);
});

test("published class list excludes a class at the exact start time", async () => {
  state.scheduledAt = new Date().toISOString();
  const response = await fetch(`${base}/api/classes`);
  assert.equal(response.status, 200);
  const list = await response.json() as Array<{ id: string }>;
  assert.equal(list.some((row) => row.id === CLASS_ID), false);
});

test("class detail for a started class stays visible and join is closed", async () => {
  state.scheduledAt = "2026-09-08T11:00:00.000Z";
  const detail = await fetch(`${base}/api/classes/${CLASS_ID}`);
  assert.equal(detail.status, 200);
  const body = await detail.json() as { id: string; scheduled_at: string };
  assert.equal(body.id, CLASS_ID);
  assert.equal(body.scheduled_at, "2026-09-08T11:00:00.000Z");

  const cookie = await login(base);
  calls.length = 0;
  const join = await fetch(`${base}/api/classes/${CLASS_ID}/participants`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(join.status, 409);
  assert.deepEqual(await join.json(), { error: CLASS_STARTED_MESSAGE });
  assert.equal(calls.some((call) => call.pathname === "/rest/v1/rpc/join_class"), false);
});

test("join maps a class_started RPC error to a closed-recruitment message", async () => {
  state.joinError = "class_started";
  const cookie = await login(base);
  const join = await fetch(`${base}/api/classes/${CLASS_ID}/participants`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(join.status, 409);
  assert.deepEqual(await join.json(), { error: CLASS_STARTED_MESSAGE });
});
