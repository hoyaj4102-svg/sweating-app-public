import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register(new URL("./resolve-ts.mjs", import.meta.url), import.meta.url);

const { requireAdmin } = await import("../src/lib/data.ts");
const {
  isClassRevealOpen,
  REVEAL_ATTENDANCE_MESSAGE,
  REVEAL_OPEN_MESSAGE,
  REVEAL_WAITING_MESSAGE,
} = await import("../src/lib/reveal.ts");
const { getRevealedParticipants } = await import("../src/lib/social.ts");

const NOW = Date.parse("2026-11-04T12:00:00.000Z");
const CLASS_ID = "30000000-0000-4000-8000-000000000002";
const VIEWER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ATTENDED = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const NO_SHOW = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const REGISTERED = "ffffffff-ffff-4fff-8fff-ffffffffffff";

function profile(id, displayName) {
  return {
    id,
    display_name: displayName,
    profile_photo_url: "",
    sports: ["러닝"],
    interests: ["커피"],
    bio: `${displayName} bio`,
    birth_year: 1998,
    age_preference: "both",
  };
}

function participant(userId, attendanceStatus) {
  return {
    id: `p-${userId.slice(0, 8)}`,
    user_id: userId,
    class_id: CLASS_ID,
    joined_at: "2026-11-04T09:00:00.000Z",
    attendance_status: attendanceStatus,
  };
}

function classRow(scheduledAt, status = "completed") {
  return {
    id: CLASS_ID,
    gym_id: "10000000-0000-4000-8000-000000000001",
    title: "past class",
    sport_type: "러닝",
    description: null,
    scheduled_at: scheduledAt,
    duration_minutes: 60,
    capacity: 8,
    price: 0,
    image_url: null,
    status,
    created_at: "2026-11-01T00:00:00.000Z",
    gyms: {
      id: "10000000-0000-4000-8000-000000000001",
      name: "웨이브",
      description: null,
      address: "예시시",
      city: "예시시",
      latitude: null,
      longitude: null,
      image_url: null,
      created_at: "2026-11-01T00:00:00.000Z",
    },
  };
}

function installFetch(rows) {
  const previous = globalThis.fetch;
  process.env.SUPABASE_URL = "https://sql-test.invalid";
  process.env.SUPABASE_ANON_KEY = "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  globalThis.fetch = async (url) => {
    const href = String(url);
    let body = [];
    if (href.includes("/rest/v1/classes")) body = [rows.classRow];
    else if (href.includes("/rest/v1/class_participants")) body = rows.participants;
    else if (href.includes("/rest/v1/profiles")) body = rows.profiles;
    else if (href.includes("/rest/v1/likes")) body = [];
    else if (href.includes("/rest/v1/matches")) body = [];
    else body = rows.fallback ?? null;
    if (body === null) {
      return new Response(JSON.stringify({ message: `unmocked ${href}` }), { status: 500 });
    }
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  return () => {
    globalThis.fetch = previous;
  };
}

function mockResponse() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

function names(result) {
  return result.participants.map((participant) => participant.display_name).sort();
}

test("reveal clock opens at the scheduled end and stays shut before it", () => {
  const row = {
    status: "completed",
    scheduled_at: "2026-11-04T11:00:00.000Z",
    duration_minutes: 60,
  };
  assert.equal(isClassRevealOpen(row, NOW), true);
  assert.equal(isClassRevealOpen(row, NOW - 1), false);
  assert.equal(isClassRevealOpen({ ...row, status: "published" }, NOW + 60_000), false);
});

test("completed before the scheduled end does not reveal profiles", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: NOW });
  const restore = installFetch({
    classRow: classRow("2026-11-04T11:30:00.000Z"),
    participants: [
      participant(VIEWER, "attended"),
      participant(ATTENDED, "attended"),
      participant(NO_SHOW, "no_show"),
      participant(REGISTERED, "registered"),
    ],
    profiles: [
      profile(VIEWER, "Viewer"),
      profile(ATTENDED, "Attended Friend"),
      profile(NO_SHOW, "No Show"),
      profile(REGISTERED, "Registered"),
    ],
  });
  try {
    const result = await getRevealedParticipants(CLASS_ID, VIEWER);
    assert.equal(result.is_revealed, false);
    assert.deepEqual(result.participants, []);
    assert.equal(result.message, REVEAL_WAITING_MESSAGE);
    assert.equal(result.class.participant_count, 4);
    assert.equal(JSON.stringify(result).includes("Attended Friend"), false);
    assert.equal(JSON.stringify(result).includes("No Show"), false);
  } finally {
    restore();
    t.mock.timers.reset();
  }
});

test("after the scheduled end only attended participants are revealed", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: NOW });
  const restore = installFetch({
    classRow: classRow("2026-11-04T10:00:00.000Z"),
    participants: [
      participant(VIEWER, "attended"),
      participant(ATTENDED, "attended"),
      participant(NO_SHOW, "no_show"),
      participant(REGISTERED, "registered"),
    ],
    profiles: [
      profile(VIEWER, "Viewer"),
      profile(ATTENDED, "Attended Friend"),
      profile(NO_SHOW, "No Show"),
      profile(REGISTERED, "Registered"),
    ],
  });
  try {
    const result = await getRevealedParticipants(CLASS_ID, VIEWER);
    assert.equal(result.is_revealed, true);
    assert.equal(result.message, REVEAL_OPEN_MESSAGE);
    assert.deepEqual(names(result), ["Attended Friend"]);
    assert.equal(result.participants.some((person) => person.display_name === "No Show"), false);
    assert.equal(result.participants.some((person) => person.display_name === "Registered"), false);
    assert.equal(result.participants.some((person) => person.display_name === "Viewer"), false);
  } finally {
    restore();
    t.mock.timers.reset();
  }
});

test("no_show and registered callers are not shown a reveal after the end", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: NOW });
  const restore = installFetch({
    classRow: classRow("2026-11-04T10:00:00.000Z"),
    participants: [
      participant(VIEWER, "attended"),
      participant(ATTENDED, "attended"),
      participant(NO_SHOW, "no_show"),
      participant(REGISTERED, "registered"),
    ],
    profiles: [
      profile(VIEWER, "Viewer"),
      profile(ATTENDED, "Attended Friend"),
      profile(NO_SHOW, "No Show"),
      profile(REGISTERED, "Registered"),
    ],
  });
  try {
    for (const caller of [NO_SHOW, REGISTERED]) {
      const result = await getRevealedParticipants(CLASS_ID, caller);
      assert.equal(result.is_revealed, false);
      assert.deepEqual(result.participants, []);
      assert.equal(result.message, REVEAL_ATTENDANCE_MESSAGE);
      assert.equal(JSON.stringify(result.participants).includes("Attended Friend"), false);
    }
  } finally {
    restore();
    t.mock.timers.reset();
  }
});

test("admin guard rejects missing and non-admin profiles and accepts is_admin", async () => {
  const session = {
    accessToken: "user-access-token",
    user: { id: VIEWER, email: "a@example.com" },
  };
  const cases = [
    { rows: [], expectProfile: false },
    { rows: [{ id: VIEWER, is_admin: false, display_name: "User A" }], expectProfile: false },
    { rows: [{ id: VIEWER, is_admin: true, display_name: "Admin" }], expectProfile: true },
  ];
  for (const item of cases) {
    const restore = installFetch({ profiles: item.rows });
    const response = mockResponse();
    try {
      const profileRow = await requireAdmin(session, response);
      if (item.expectProfile) {
        assert.equal(profileRow?.is_admin, true);
        assert.equal(response.statusCode, 200);
      } else {
        assert.equal(profileRow, null);
        assert.equal(response.statusCode, 403);
        assert.match(response.body.error, /관리자/);
      }
    } finally {
      restore();
    }
  }
});
