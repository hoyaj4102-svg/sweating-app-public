import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import test from "node:test";
import {
  emptyBuckets,
  scrubLogPath,
  serverTimingEnabled,
  serverTimingHeader,
  timingLogFields,
} from "../src/lib/request-timing.ts";

const ANON = "test-anon-key";
const SERVICE = "test-service-role-key";
const ACCESS = "user-access-token";
const CLASS_ID = "33333333-3333-4333-8333-333333333333";
const USER = "11111111-1111-4111-8111-111111111111";

process.env.NODE_ENV = "production";
process.env.LOG_LEVEL = "silent";
process.env.SESSION_SECRET = "test-session-secret";
process.env.SUPABASE_URL = "https://example.test";
process.env.SUPABASE_ANON_KEY = ANON;
process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE;

const originalFetch = globalThis.fetch;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function installFetch(): void {
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname !== "example.test") return originalFetch(input, init);
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? init.body : null;
    if (url.pathname.startsWith("/auth/")) await delay(40);
    if (url.pathname.startsWith("/rest/")) await delay(25);

    if (url.pathname === "/auth/v1/token") {
      return json(200, {
        access_token: ACCESS,
        refresh_token: "refresh-token",
        user: { id: USER, email: "member@example.test" },
      });
    }
    if (url.pathname === "/auth/v1/user") {
      return json(200, { id: USER, email: "member@example.test" });
    }
    if (url.pathname === "/rest/v1/rpc/current_consents_complete") return json(200, true);
    if (url.pathname === "/rest/v1/profiles") {
      return json(200, [{
        id: USER,
        display_name: "Member",
        birth_year: 1994,
        age_preference: "both",
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
    if (url.pathname === "/rest/v1/classes") {
      return json(200, [{
        id: CLASS_ID,
        gym_id: "44444444-4444-4444-8444-444444444444",
        title: "Morning run",
        sport_type: "러닝",
        description: null,
        scheduled_at: "2027-06-06T01:00:00.000Z",
        duration_minutes: 60,
        capacity: 8,
        price: 0,
        image_url: null,
        age_band: null,
        status: "published",
        created_at: "2026-10-01T00:00:00.000Z",
        gyms: {
          id: "44444444-4444-4444-8444-444444444444",
          name: "Sample Gym",
          description: null,
          address: "Busan",
          city: "Busan",
          latitude: null,
          longitude: null,
          image_url: null,
          created_at: "2026-10-01T00:00:00.000Z",
        },
      }]);
    }
    if (url.pathname === "/rest/v1/rpc/class_seat_counts") {
      const parsed = body ? JSON.parse(body) as { p_class_ids?: string[] } : {};
      return json(200, (parsed.p_class_ids ?? []).map((classId) => ({
        class_id: classId,
        occupied: 1,
        is_joined: false,
      })));
    }
    throw new Error(`Unexpected Supabase request ${method} ${url.pathname}`);
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function metric(header: string, name: string): { dur: number; desc: string | null } {
  const match = header.split(",").map((part) => part.trim()).find((part) => part.startsWith(`${name};`));
  assert.ok(match, header);
  const dur = Number(/dur=([0-9.]+)/.exec(match)?.[1]);
  const desc = /desc="([^"]*)"/.exec(match)?.[1] ?? null;
  assert.equal(Number.isFinite(dur), true);
  return { dur, desc };
}

test("log fields keep durations and drop ids, emails, and query strings", () => {
  const fields = timingLogFields({
    path: "/api/classes/33333333-3333-4333-8333-333333333333?email=member@example.test",
    buckets: { authMs: 12.24, authCount: 1, dbMs: 40.05, dbCount: 2 },
    totalMs: 55.19,
  });
  assert.deepEqual(Object.keys(fields).sort(), [
    "auth_ms",
    "auth_roundtrips",
    "db_ms",
    "db_roundtrips",
    "path",
    "total_ms",
  ]);
  assert.equal(fields.path, "/api/classes/:id");
  assert.equal(fields.auth_ms, 12.2);
  assert.equal(fields.db_ms, 40.1);
  assert.equal(fields.total_ms, 55.2);
  const encoded = JSON.stringify(fields);
  assert.equal(encoded.includes("@"), false);
  assert.equal(encoded.includes("33333333"), false);
  assert.equal(encoded.includes("member"), false);
  assert.equal(scrubLogPath("/api/auth/recover?email=member@example.test"), "/api/auth/recover");
  assert.equal(serverTimingHeader(emptyBuckets(), 1).includes("@"), false);
});

let server: Server | undefined;
let base = "";

test.before(async () => {
  delete process.env.VERCEL_ENV;
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

test("anonymous class list separates auth from database time", async () => {
  const response = await fetch(`${base}/api/classes`);
  assert.equal(response.status, 200);
  const header = response.headers.get("server-timing") ?? "";
  const auth = metric(header, "auth");
  const db = metric(header, "db");
  const total = metric(header, "total");
  assert.equal(auth.desc, "n=0");
  assert.equal(auth.dur < 15, true, header);
  assert.equal(db.desc, "n=2");
  assert.equal(db.dur >= 40, true, header);
  assert.equal(total.dur >= db.dur, true, header);
  assert.equal(header.includes(CLASS_ID), false);
  assert.equal(header.includes("@"), false);
  assert.equal(header.includes(ANON), false);
  await response.arrayBuffer();
});

test("a signed-in class list counts the auth check apart from database calls", async () => {
  const login = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "member@example.test", password: "password12" }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
  await login.arrayBuffer();

  const response = await fetch(`${base}/api/classes`, { headers: { cookie } });
  assert.equal(response.status, 200);
  const header = response.headers.get("server-timing") ?? "";
  const auth = metric(header, "auth");
  const db = metric(header, "db");
  assert.equal(auth.desc, "n=1");
  assert.equal(db.desc, "n=3");
  assert.equal(auth.dur >= 30, true, header);
  assert.equal(auth.dur < 80, true, header);
  assert.equal(db.dur >= 60, true, header);
  assert.equal(header.includes("member@example.test"), false);
  assert.equal(header.includes(ACCESS), false);
  await response.arrayBuffer();
});

test("Server-Timing is absent in production and present otherwise", async () => {
  assert.equal(serverTimingEnabled({ VERCEL_ENV: "production" }), false);
  assert.equal(serverTimingEnabled({ VERCEL_ENV: "preview" }), true);
  assert.equal(serverTimingEnabled({}), true);
  const previous = process.env.VERCEL_ENV;
  try {
    process.env.VERCEL_ENV = "production";
    const production = await fetch(`${base}/api/healthz`);
    assert.equal(production.status, 200);
    assert.equal(production.headers.get("server-timing"), null);
    await production.arrayBuffer();

    process.env.VERCEL_ENV = "preview";
    const preview = await fetch(`${base}/api/healthz`);
    assert.equal(preview.status, 200);
    assert.match(preview.headers.get("server-timing") ?? "", /auth;dur=/);
    assert.match(preview.headers.get("server-timing") ?? "", /db;dur=/);
    assert.match(preview.headers.get("server-timing") ?? "", /total;dur=/);
    await preview.arrayBuffer();

    delete process.env.VERCEL_ENV;
    const local = await fetch(`${base}/api/classes`);
    assert.equal(local.status, 200);
    assert.match(local.headers.get("server-timing") ?? "", /db;dur=/);
    await local.arrayBuffer();
  } finally {
    if (previous === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = previous;
  }
});
