import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { once } from "node:events";
import http from "node:http";
import { register } from "node:module";
import test from "node:test";

register(new URL("./resolve-ts.mjs", import.meta.url), import.meta.url);

const {
  ACK_FORBIDDEN,
  ACK_VERSION_MISMATCH,
  NOTICE_TEXT_ERROR,
  PRINCIPLES_VERSION_ERROR,
  parseOwnerNoticeWrite,
  parsePrinciplesVersion,
  sortInbox,
} = await import("../src/lib/announcements.ts");

const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const principles = {
  kind: "principles",
  title: "운영 원칙",
  body: "첫째 문단입니다.\n\n둘째 문단입니다.",
  published_at: "2026-11-12T09:10:00.000Z",
  notice_version: "owner-principles-2026-11-12",
  is_current: true,
};
const ownerNotice = {
  kind: "owner_notice",
  title: "시설 점검",
  body: "이번 주 시설 점검이 있습니다.",
  published_at: "2026-11-12T10:00:00.000Z",
  notice_version: "owner-notice-20261112190000-abcd1234",
  is_current: false,
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

function installFetch({ isAdmin = false, announcements = [], acks = [], ackResult = "2026-11-12T09:20:00.000Z", ackStatus = 200, ackMessage = "" } = {}) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const href = String(url);
    const headers = new Headers(init.headers);
    const method = init.method ?? "GET";
    const body = typeof init.body === "string" ? init.body : "";
    calls.push({ href, method, body, authorization: headers.get("authorization") });
    if (href.endsWith("/auth/v1/user")) {
      return Response.json({ id: userId, email: "user@example.com" });
    }
    if (href.includes("/rest/v1/profiles")) {
      return Response.json([{ id: userId, is_admin: isAdmin, display_name: "운영" }]);
    }
    if (href.includes("/rpc/acknowledge_owner_principles")) {
      if (ackStatus !== 200) return Response.json({ message: ackMessage }, { status: ackStatus });
      return Response.json(ackResult);
    }
    if (href.includes("/rest/v1/owner_notice_acknowledgements")) return Response.json(acks);
    if (href.includes("/rest/v1/announcements")) {
      if (method === "POST") return Response.json([JSON.parse(body)]);
      if (href.includes("kind=eq.owner_notice")) return Response.json(announcements.filter((row) => row.kind === "owner_notice"));
      return Response.json(announcements);
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

test("announcement parsers accept only the fields the client may send", () => {
  assert.deepEqual(parsePrinciplesVersion({ notice_version: "owner-principles-2026-11-12" }), {
    ok: true,
    value: "owner-principles-2026-11-12",
  });
  assert.deepEqual(parsePrinciplesVersion({ notice_version: "owner-notice-1" }), {
    ok: false,
    error: PRINCIPLES_VERSION_ERROR,
  });
  assert.deepEqual(parsePrinciplesVersion({ notice_version: "owner-principles-2026-11-12", user_id: userId }), {
    ok: false,
    error: PRINCIPLES_VERSION_ERROR,
  });
  assert.deepEqual(parseOwnerNoticeWrite({ title: " 시설 점검 ", body: " 본문 " }), {
    ok: true,
    value: { title: "시설 점검", body: "본문" },
  });
  assert.deepEqual(parseOwnerNoticeWrite({ title: "시설", body: "본문", kind: "principles" }), {
    ok: false,
    error: NOTICE_TEXT_ERROR,
  });
});

test("the inbox pins the current principles ahead of a later notice", () => {
  const sorted = sortInbox([
    { ...ownerNotice, acknowledged_at: null },
    { ...principles, acknowledged_at: "2026-11-12T09:20:00.000Z" },
  ]);
  assert.equal(sorted[0].notice_version, principles.notice_version);
  assert.equal(sorted[1].notice_version, ownerNotice.notice_version);
});

test("a signed-in user reads announcements with the user token and never an author id", async () => {
  const calls = installFetch({
    announcements: [ownerNotice, principles],
    acks: [{ notice_version: principles.notice_version, acknowledged_at: "2026-11-12T09:20:00.000Z" }],
  });
  const anonymous = await request("GET", "/api/messages");
  assert.equal(anonymous.status, 401);
  assert.equal(calls.some((call) => call.href.includes("/rest/v1/announcements")), false);

  const result = await request("GET", "/api/messages", { cookie: signedSession() });
  assert.equal(result.status, 200);
  assert.equal(result.body.announcements[0].notice_version, principles.notice_version);
  assert.equal(result.body.announcements[0].acknowledged_at, "2026-11-12T09:20:00.000Z");
  assert.equal(result.body.announcements[1].acknowledged_at, null);
  assert.equal(result.raw.includes("author_id"), false);
  assert.equal(result.raw.includes(userId), false);
  const reads = calls.filter((call) => call.href.includes("/rest/v1/announcements") || call.href.includes("owner_notice_acknowledgements"));
  assert.equal(reads.length, 2);
  assert.ok(reads.every((call) => call.authorization === "Bearer user-access-token"));
  assert.ok(reads.every((call) => !call.href.includes("author_id")));
});

test("acknowledging principles uses the user token and keeps the stored timestamp", async () => {
  let calls = installFetch({});
  const rejected = await request("POST", "/api/messages/principles/acknowledge", {
    cookie: signedSession(),
    body: { notice_version: "owner-principles-2026-11-12", user_id: userId },
  });
  assert.equal(rejected.status, 400);
  assert.equal(calls.some((call) => call.href.includes("acknowledge_owner_principles")), false);

  calls = installFetch({ ackStatus: 403, ackMessage: "approved_owner_required" });
  const forbidden = await request("POST", "/api/messages/principles/acknowledge", {
    cookie: signedSession(),
    body: { notice_version: "owner-principles-2026-11-12" },
  });
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.body.error, ACK_FORBIDDEN);

  calls = installFetch({ ackStatus: 400, ackMessage: "principles_version_mismatch" });
  const mismatch = await request("POST", "/api/messages/principles/acknowledge", {
    cookie: signedSession(),
    body: { notice_version: "owner-principles-2026-11-12" },
  });
  assert.equal(mismatch.status, 409);
  assert.equal(mismatch.body.error, ACK_VERSION_MISMATCH);

  calls = installFetch({ ackResult: "2026-11-12T09:20:00.000Z" });
  const acked = await request("POST", "/api/messages/principles/acknowledge", {
    cookie: signedSession(),
    body: { notice_version: "owner-principles-2026-11-12" },
  });
  assert.equal(acked.status, 200);
  assert.deepEqual(acked.body, {
    notice_version: "owner-principles-2026-11-12",
    acknowledged_at: "2026-11-12T09:20:00.000Z",
  });
  const rpc = calls.find((call) => call.href.includes("acknowledge_owner_principles"));
  assert.equal(rpc?.authorization, "Bearer user-access-token");
  assert.deepEqual(JSON.parse(rpc.body), { p_version: "owner-principles-2026-11-12" });
});

test("only an admin publishes an owner notice, with the service role and no client author", async () => {
  let calls = installFetch({ isAdmin: false });
  const member = await request("POST", "/api/admin/announcements", {
    cookie: signedSession(),
    body: { title: "시설 점검", body: "이번 주 시설 점검이 있습니다." },
  });
  assert.equal(member.status, 403);
  assert.equal(calls.some((call) => call.method === "POST" && call.href.includes("/rest/v1/announcements")), false);

  calls = installFetch({ isAdmin: true });
  const created = await request("POST", "/api/admin/announcements", {
    cookie: signedSession(),
    body: { title: "시설 점검", body: "이번 주 시설 점검이 있습니다." },
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.announcement.kind, "owner_notice");
  assert.equal(created.body.announcement.is_current, false);
  assert.match(created.body.announcement.notice_version, /^owner-notice-\d{14}-[0-9a-f]{8}$/);
  assert.equal(Object.hasOwn(created.body.announcement, "author_id"), false);
  assert.equal(created.raw.includes(userId), false);
  const insert = calls.find((call) => call.method === "POST" && call.href.includes("/rest/v1/announcements"));
  assert.equal(insert?.authorization, "Bearer test-service");
  const posted = JSON.parse(insert.body);
  assert.equal(posted.kind, "owner_notice");
  assert.equal(posted.author_id, userId);
  assert.equal(posted.is_current, false);
  assert.equal(posted.title, "시설 점검");

  calls = installFetch({ isAdmin: true, announcements: [ownerNotice, principles] });
  const listed = await request("GET", "/api/admin/announcements", { cookie: signedSession() });
  assert.equal(listed.status, 200);
  assert.deepEqual(listed.body.announcements.map((row) => row.notice_version), [ownerNotice.notice_version]);
  const listCall = calls.find((call) => call.method === "GET" && call.href.includes("/rest/v1/announcements"));
  assert.equal(listCall?.authorization, "Bearer test-service");
  assert.match(listCall.href, /kind=eq\.owner_notice/);
  assert.equal(listCall.href.includes("author_id"), false);
});
