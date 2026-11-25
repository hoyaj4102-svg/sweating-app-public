import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import http from "node:http";
import { register } from "node:module";
import test from "node:test";

register(new URL("./resolve-ts.mjs", import.meta.url), import.meta.url);

const VIEWER = "11111111-1111-4111-8111-111111111111";
const PEER = "22222222-2222-4222-8222-222222222222";
const MISMATCH = "33333333-3333-4333-8333-333333333333";
const OWNER = "44444444-4444-4444-8444-444444444444";
const ADMIN = "55555555-5555-4555-8555-555555555555";
const CLASS_ID = "66666666-6666-4666-8666-666666666666";
const GYM_ID = "77777777-7777-4777-8777-777777777777";
const MATCH_ID = "88888888-8888-4888-8888-888888888888";
const MISMATCH_MATCH = "88888888-8888-4888-8888-888888888889";
const VIEWER_ROW = "99999999-9999-4999-8999-999999999991";
const PEER_ROW = "99999999-9999-4999-8999-999999999992";
const MISMATCH_ROW = "99999999-9999-4999-8999-999999999993";
const SERVICE_KEY = "test-service-role";

const state = {
  ended: false,
  peerPhoto: `profile-photos/${PEER}/avatar.jpg`,
};
const signCalls: string[] = [];
const missed: string[] = [];

function cookieFor(userId: string): string {
  const value = JSON.stringify({
    accessToken: userId,
    user: { id: userId, email: "member@example.test" },
  });
  const signature = createHmac("sha256", "test-only-session-secret")
    .update(value)
    .digest("base64")
    .replace(/=+$/, "");
  return `swetin_session=${encodeURIComponent(`s:${value}.${signature}`)}`;
}

function classRow() {
  const start = state.ended ? Date.now() - 3 * 60 * 60 * 1000 : Date.now() - 30 * 60 * 1000;
  return {
    id: CLASS_ID,
    gym_id: GYM_ID,
    title: "Evening run",
    sport_type: "러닝",
    description: null,
    scheduled_at: new Date(start).toISOString(),
    duration_minutes: 60,
    capacity: 8,
    price: 0,
    image_url: null,
    status: "completed",
    age_band: "20_25",
    created_at: "2026-11-01T00:00:00.000Z",
    gyms: {
      id: GYM_ID,
      name: "Gym",
      description: null,
      address: "Busan",
      city: "Busan",
      latitude: null,
      longitude: null,
      image_url: null,
      created_at: "2026-11-01T00:00:00.000Z",
    },
  };
}

function photoFor(id: string): string {
  if (id === PEER) return state.peerPhoto;
  if (id === MISMATCH) return `profile-photos/${MISMATCH}/avatar.jpg`;
  if (id === VIEWER) return `profile-photos/${VIEWER}/avatar.jpg`;
  return "";
}

function seoulYear(now = new Date()): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Seoul", year: "numeric" }).format(now));
}

function profile(id: string) {
  return {
    id,
    display_name: id === PEER ? "Peer" : id === MISMATCH ? "Mismatch" : "Member",
    birth_year: id === MISMATCH ? seoulYear() - 50 : 1996,
    age_preference: id === MISMATCH ? "same_band" : "both",
    gender: null,
    profile_photo_url: photoFor(id),
    sports: ["러닝"],
    interests: ["커피"],
    bio: null,
    is_admin: id === ADMIN,
    created_at: "2026-11-01T00:00:00.000Z",
    updated_at: "2026-11-01T00:00:00.000Z",
  };
}

function participants() {
  return [
    { id: VIEWER_ROW, user_id: VIEWER, class_id: CLASS_ID, joined_at: "2026-11-01T00:00:00.000Z", attendance_status: "attended" },
    { id: PEER_ROW, user_id: PEER, class_id: CLASS_ID, joined_at: "2026-11-01T00:00:00.000Z", attendance_status: "attended" },
    { id: MISMATCH_ROW, user_id: MISMATCH, class_id: CLASS_ID, joined_at: "2026-11-01T00:00:00.000Z", attendance_status: "attended" },
  ];
}

function idsIn(search: string): string[] | null {
  const text = decodeURIComponent(search);
  const single = text.match(/(?:^|[?&])id=eq\.([^&]+)/);
  if (single?.[1]) return [single[1]];
  const many = text.match(/id=in\.\(([^)]*)\)/);
  if (many?.[1]) return many[1].split(",").filter(Boolean);
  const user = text.match(/user_id=eq\.([^&]+)/);
  if (user?.[1]) return [user[1]];
  return null;
}

function installFetch() {
  const previous = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    if (String(input).startsWith("http://127.0.0.1")) return previous(input, init);
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    if (url.pathname === "/auth/v1/user") {
      const id = (headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
      return Response.json({ id, email: "member@example.test" });
    }
    if (url.pathname.startsWith("/storage/v1/object/sign/")) {
      signCalls.push(headers.get("authorization") ?? "");
      const tail = url.pathname.slice("/storage/v1/object/sign".length);
      return Response.json({ signedURL: `/object/sign${tail}?token=short` });
    }
    if (url.pathname === "/rest/v1/profiles") {
      const ids = idsIn(url.search) ?? [VIEWER, PEER, MISMATCH, OWNER, ADMIN];
      return Response.json(ids.map(profile));
    }
    if (url.pathname === "/rest/v1/class_participants") {
      const ids = idsIn(url.search);
      const rows = participants().filter((row) => !ids || ids.includes(row.user_id) || ids.includes(row.id));
      return Response.json(rows);
    }
    if (url.pathname === "/rest/v1/classes") return Response.json([classRow()]);
    if (url.pathname === "/rest/v1/likes") return Response.json([]);
    if (url.pathname === "/rest/v1/matches") {
      const rows = [
        {
          id: MATCH_ID,
          class_id: CLASS_ID,
          user_a_id: VIEWER,
          user_b_id: PEER,
          created_at: "2026-11-02T00:00:00.000Z",
        },
        {
          id: MISMATCH_MATCH,
          class_id: CLASS_ID,
          user_a_id: VIEWER,
          user_b_id: MISMATCH,
          created_at: "2026-11-01T00:00:00.000Z",
        },
      ];
      const ids = idsIn(url.search);
      return Response.json(ids ? rows.filter((row) => ids.includes(row.id)) : rows);
    }
    if (url.pathname === "/rest/v1/rpc/owned_gym_ids") return Response.json([GYM_ID]);
    if (url.pathname === "/rest/v1/rpc/owner_class_roster") {
      return Response.json([{
        id: PEER_ROW,
        user_id: PEER,
        attendance_status: "attended",
        display_name: "Peer",
        profile_photo_url: state.peerPhoto,
      }]);
    }
    if (url.pathname === "/rest/v1/rpc/class_seat_counts") {
      return Response.json([{ class_id: CLASS_ID, occupied: 3, is_joined: true }]);
    }
    if (url.pathname === "/rest/v1/rpc/record_attendance") {
      return Response.json([{
        id: PEER_ROW,
        class_id: CLASS_ID,
        user_id: PEER,
        attendance_status: "attended",
        payment_status: "free",
        profile_photo_url: state.peerPhoto,
      }]);
    }
    if (url.pathname === "/rest/v1/gym_owners") return Response.json([{ user_id: OWNER }]);
    missed.push(`${method} ${url.pathname}${url.search}`);
    return Response.json({ message: "unmocked" }, { status: 500 });
  };
  return () => {
    globalThis.fetch = previous;
  };
}

function assertHidden(text: string, label: string) {
  assert.equal(/profile-photos\//i.test(text), false, `${label} storage path`);
  assert.equal(/\/object\/(?:sign|public|authenticated)\//i.test(text), false, `${label} object url`);
  assert.equal(/token=/i.test(text), false, `${label} signed token`);
  assert.equal(text.includes("example.test/face"), false, `${label} legacy photo`);
}

test("blind photos stay out of server responses until reveal", async () => {
  process.env.NODE_ENV = "test";
  process.env.SESSION_SECRET = "test-only-session-secret";
  process.env.SUPABASE_URL = "https://example.test";
  process.env.SUPABASE_ANON_KEY = "test-anon";
  process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;
  process.env.LOG_LEVEL = "silent";

  const restore = installFetch();
  const { createApp } = await import("../src/create-app.ts");
  const server = http.createServer(createApp());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  const base = `http://127.0.0.1:${address.port}`;

  async function call(method: string, path: string, userId: string, body?: unknown) {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        cookie: cookieFor(userId),
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    return { status: response.status, text, json: text ? JSON.parse(text) as Record<string, unknown> : null };
  }

  try {
    state.ended = false;
    state.peerPhoto = `profile-photos/${PEER}/avatar.jpg`;
    signCalls.length = 0;

    const revealed = await call("GET", `/api/classes/${CLASS_ID}/revealed-participants`, VIEWER);
    assert.equal(revealed.status, 200, `${revealed.text} missed=${missed.join(" | ")}`);
    assert.equal((revealed.json as { is_revealed?: boolean }).is_revealed, false);
    assert.deepEqual((revealed.json as { participants?: unknown[] }).participants, []);
    assertHidden(revealed.text, "revealed-participants before end");

    const blind = await call("GET", `/api/classes/${CLASS_ID}/blind`, VIEWER);
    assert.equal(blind.status, 200, blind.text);
    assert.deepEqual((blind.json as { participants?: unknown[] }).participants, []);
    assertHidden(blind.text, "blind before end");

    const matches = await call("GET", "/api/matches", VIEWER);
    assert.equal(matches.status, 200, matches.text);
    const matchRows = matches.json as Array<{ participant: { profile_photo_url: string } }>;
    assert.ok(matchRows.length >= 1);
    assert.ok(matchRows.every((row) => row.participant.profile_photo_url === ""));
    assertHidden(matches.text, "matches before end");

    const oneMatch = await call("GET", `/api/matches/${MATCH_ID}`, VIEWER);
    assert.equal(oneMatch.status, 200, oneMatch.text);
    assert.equal((oneMatch.json as { participant: { profile_photo_url: string } }).participant.profile_photo_url, "");
    assertHidden(oneMatch.text, "match before end");

    for (const path of ["/api/classes", "/api/activity"]) {
      const listed = await call("GET", path, VIEWER);
      assert.equal(listed.status, 200, `${path} ${listed.text}`);
      assertHidden(listed.text, path);
    }
    const detail = await call("GET", `/api/classes/${CLASS_ID}`, VIEWER);
    assert.equal(detail.status, 404, detail.text);
    assertHidden(detail.text, "class detail");

    const roster = await call("GET", `/api/owner/classes/${CLASS_ID}/participants`, OWNER);
    assert.equal(roster.status, 200, roster.text);
    assert.equal((roster.json as Array<{ display_name: string }>)[0]?.display_name, "Peer");
    assertHidden(roster.text, "owner roster");

    const attendance = await call(
      "PATCH",
      `/api/owner/classes/${CLASS_ID}/participants/${PEER}/attendance`,
      OWNER,
      { attendance_status: "attended" },
    );
    assert.equal(attendance.status, 200, attendance.text);
    assertHidden(attendance.text, "owner attendance");
    assert.equal(signCalls.length, 0);

    state.peerPhoto = "https://example.test/face.jpg";
    const legacyMatch = await call("GET", "/api/matches", VIEWER);
    assert.equal(legacyMatch.status, 200, legacyMatch.text);
    assert.ok((legacyMatch.json as Array<{ participant: { profile_photo_url: string } }>).every((row) => row.participant.profile_photo_url === ""));
    assertHidden(legacyMatch.text, "legacy match before end");
    assert.equal(signCalls.length, 0);

    signCalls.length = 0;
    state.peerPhoto = `profile-photos/${PEER}/avatar.jpg`;
    const admin = await call("GET", `/api/admin/classes/${CLASS_ID}/participants`, ADMIN);
    assert.equal(admin.status, 200, admin.text);
    const adminPeer = (admin.json as Array<{ user_id: string; profiles: { profile_photo_url: string } | null }>).find((row) => row.user_id === PEER);
    assert.match(adminPeer?.profiles?.profile_photo_url ?? "", /^https:\/\/example\.test\/storage\/v1\/object\/sign\/profile-photos\//);
    assert.match(adminPeer?.profiles?.profile_photo_url ?? "", /token=short/);
    assert.equal(adminPeer?.profiles?.profile_photo_url === state.peerPhoto, false);
    assert.ok(signCalls.every((authorization) => authorization === `Bearer ${SERVICE_KEY}`));

    const own = await call("GET", "/api/profiles/me", VIEWER);
    assert.equal(own.status, 200, own.text);
    assert.match(String((own.json as { profile_photo_url?: string }).profile_photo_url), /\/object\/sign\/profile-photos\//);
    const me = await call("GET", "/api/auth/me", VIEWER);
    assert.equal(me.status, 200, me.text);
    assert.match(JSON.stringify(me.json), /\/object\/sign\/profile-photos\//);

    signCalls.length = 0;
    state.ended = true;
    const opened = await call("GET", `/api/classes/${CLASS_ID}/revealed-participants`, VIEWER);
    assert.equal(opened.status, 200, opened.text);
    assert.equal((opened.json as { is_revealed?: boolean }).is_revealed, true);
    const people = (opened.json as { participants: Array<{ display_name: string; profile_photo_url: string }> }).participants;
    assert.deepEqual(people.map((person) => person.display_name), ["Peer", "Mismatch"]);
    assert.ok(people.every((person) => /\/object\/sign\/profile-photos\//.test(person.profile_photo_url)));
    assert.equal(people[0]?.profile_photo_url === `profile-photos/${PEER}/avatar.jpg`, false);
    assert.ok(signCalls.length > 0);
    assert.ok(signCalls.every((authorization) => authorization === `Bearer ${SERVICE_KEY}`));

    signCalls.length = 0;
    const olderView = await call("GET", `/api/classes/${CLASS_ID}/revealed-participants`, MISMATCH);
    assert.equal(olderView.status, 200, olderView.text);
    const olderPeople = (olderView.json as { participants: Array<{ display_name: string; profile_photo_url: string }> }).participants;
    assert.deepEqual(olderPeople.map((person) => person.display_name), ["Member", "Peer"]);
    assert.ok(olderPeople.every((person) => /\/object\/sign\/profile-photos\//.test(person.profile_photo_url)));
    assert.ok(signCalls.length > 0);

    const openedMatches = await call("GET", "/api/matches", VIEWER);
    assert.equal(openedMatches.status, 200, openedMatches.text);
    const openedMatchRows = openedMatches.json as Array<{ participant: { display_name: string; profile_photo_url: string } }>;
    const olderMatch = openedMatchRows.find((row) => row.participant.display_name === "Mismatch");
    assert.ok(olderMatch);
    assert.match(olderMatch.participant.profile_photo_url, /\/object\/sign\/profile-photos\//);

    state.peerPhoto = "https://example.test/face.jpg";
    signCalls.length = 0;
    const openedLegacy = await call("GET", "/api/matches", VIEWER);
    assert.equal(openedLegacy.status, 200, openedLegacy.text);
    const openedRows = openedLegacy.json as Array<{ participant: { display_name: string; profile_photo_url: string } }>;
    assert.equal(openedRows[0]?.participant.profile_photo_url, "https://example.test/face.jpg");
    const olderLegacy = openedRows.find((row) => row.participant.display_name === "Mismatch");
    assert.ok(olderLegacy);
    assert.match(olderLegacy.participant.profile_photo_url, /\/object\/sign\/profile-photos\//);
    assert.ok(signCalls.every((authorization) => authorization === `Bearer ${SERVICE_KEY}`));
  } finally {
    restore();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
