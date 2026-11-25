import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { once } from "node:events";
import http from "node:http";
import { register } from "node:module";
import test from "node:test";

register(new URL("./resolve-ts.mjs", import.meta.url), import.meta.url);

const {
  MATCH_CHAT_BLOCKED,
  MATCH_CHAT_FORBIDDEN,
  MATCH_CHAT_RATE_LIMIT_DAY,
  MATCH_CHAT_RATE_LIMIT_MINUTE,
  MATCH_CHAT_UNBLOCK_FORBIDDEN,
  MATCH_MESSAGE_MAX_LENGTH,
  MATCH_MESSAGE_RATE_LIMIT_PER_DAY,
  MATCH_MESSAGE_RATE_LIMIT_PER_MINUTE,
  MATCH_MESSAGE_TEXT_ERROR,
  MATCH_NOT_FOUND,
  MATCH_REPORT_DETAIL_ERROR,
  MATCH_REPORT_DETAIL_MAX_LENGTH,
  MATCH_REPORT_MESSAGE_NOT_FOUND,
  MATCH_REPORT_REASON_ERROR,
  parseBefore,
  parseMatchMessageWrite,
  parseMatchReportWrite,
} = await import("../src/lib/match-messages.ts");

const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const partnerId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
const strangerA = "cccccccc-cccc-4ccc-8ccc-ccccccccccc3";
const strangerB = "dddddddd-dddd-4ddd-8ddd-ddddddddddd4";
const matchId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee5";
const otherMatchId = "ffffffff-ffff-4fff-8fff-fffffffffff6";
const missingMatchId = "99999999-9999-4999-8999-999999999999";
const messageUuid = "11111111-1111-4111-8111-111111111111";

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

const matchRows = {
  [matchId]: { id: matchId, user_a_id: userId, user_b_id: partnerId },
  [otherMatchId]: { id: otherMatchId, user_a_id: strangerA, user_b_id: strangerB },
};

// Newest first, as private.list_match_messages returns them.
const storedRows = [
  { id: "m2", match_id: matchId, sender_id: partnerId, body: "저도요!", created_at: "2026-11-24T09:01:00+00:00" },
  { id: "m1", match_id: matchId, sender_id: userId, body: "오늘 즐거웠어요", created_at: "2026-11-24T09:00:00+00:00" },
];

const reportRows = [
  {
    id: "r1",
    match_id: matchId,
    message_id: messageUuid,
    reporter_id: userId,
    reported_user_id: partnerId,
    reason: "harassment",
    detail: "불쾌한 표현",
    created_at: "2026-11-25T00:00:00+00:00",
  },
];

function installFetch({
  isAdmin = false,
  rpcStatus = 200,
  rpcMessage = "",
  blockStatus = { is_blocked: false, blocked_by_me: false },
} = {}) {
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
      return Response.json([{ id: userId, is_admin: isAdmin, display_name: "회원" }]);
    }
    if (href.includes("/rest/v1/matches")) {
      const id = new URL(href).searchParams.get("id")?.replace(/^eq\./, "") ?? "";
      return Response.json(matchRows[id] ? [matchRows[id]] : []);
    }
    if (href.includes("/rest/v1/match_chat_reports")) {
      return Response.json(isAdmin ? reportRows : []);
    }
    if (href.includes("/rpc/")) {
      if (rpcStatus !== 200) return Response.json({ message: rpcMessage }, { status: rpcStatus });
      if (href.includes("list_match_messages")) return Response.json(storedRows);
      if (href.includes("get_match_chat_status")) return Response.json(blockStatus);
      if (href.includes("block_match_chat") && !href.includes("unblock")) {
        return Response.json({ is_blocked: true, blocked_by_me: true });
      }
      if (href.includes("unblock_match_chat")) {
        return Response.json({ is_blocked: false, blocked_by_me: false });
      }
      if (href.includes("report_match_chat")) {
        return Response.json({ id: "r-new", created_at: "2026-11-25T00:01:00+00:00" });
      }
      if (href.includes("send_match_message")) {
        const sent = JSON.parse(body);
        return Response.json({
          id: "m3",
          match_id: sent.p_match_id,
          sender_id: userId,
          body: sent.p_body,
          created_at: "2026-11-24T09:02:00+00:00",
        });
      }
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
            ...(body !== undefined ? { "content-type": "application/json" } : {}),
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
      if (body !== undefined) req.write(JSON.stringify(body));
      req.end();
    });
  } finally {
    server.close();
  }
}

const rpcCalls = (calls) => calls.filter((call) => call.href.includes("/rpc/"));

test("message and report parsers enforce lengths, allowed reasons, and field allowlists", () => {
  assert.equal(MATCH_MESSAGE_MAX_LENGTH, 1000);
  assert.equal(MATCH_MESSAGE_RATE_LIMIT_PER_MINUTE, 10);
  assert.equal(MATCH_MESSAGE_RATE_LIMIT_PER_DAY, 100);
  assert.equal(MATCH_REPORT_DETAIL_MAX_LENGTH, 500);
  assert.deepEqual(parseMatchMessageWrite({ body: "  안녕하세요  " }), { ok: true, value: "안녕하세요" });
  assert.deepEqual(parseMatchMessageWrite({ body: "가".repeat(1000) }), { ok: true, value: "가".repeat(1000) });
  // Emoji are two UTF-16 units but one Postgres character.
  assert.equal(parseMatchMessageWrite({ body: "💪".repeat(1000) }).ok, true);
  for (const bad of [
    { body: "가".repeat(1001) },
    { body: "💪".repeat(1001) },
    { body: "" },
    { body: "   \n\t " },
    { body: 42 },
    { body: "hi", sender_id: userId },
    { body: "hi", match_id: matchId },
    [],
    null,
    "hi",
  ]) {
    assert.deepEqual(parseMatchMessageWrite(bad), { ok: false, error: MATCH_MESSAGE_TEXT_ERROR });
  }
  assert.deepEqual(parseBefore(undefined), { ok: true, value: null });
  assert.deepEqual(parseBefore("2026-11-24T09:00:00Z"), { ok: true, value: "2026-11-24T09:00:00.000Z" });
  assert.deepEqual(parseBefore("not-a-date"), { ok: false });
  assert.deepEqual(parseBefore(["2026-11-24"]), { ok: false });

  assert.deepEqual(
    parseMatchReportWrite({ reason: "harassment", detail: "  욕설  ", message_id: messageUuid }),
    { ok: true, value: { reason: "harassment", detail: "욕설", message_id: messageUuid } },
  );
  assert.deepEqual(
    parseMatchReportWrite({ reason: "other", detail: "   " }),
    { ok: true, value: { reason: "other", detail: null, message_id: null } },
  );
  assert.equal(parseMatchReportWrite({ reason: "spam", detail: "가".repeat(500) }).ok, true);
  assert.deepEqual(parseMatchReportWrite({ reason: "spam", detail: "가".repeat(501) }), { ok: false, error: MATCH_REPORT_DETAIL_ERROR });
  assert.deepEqual(parseMatchReportWrite({ reason: "bogus" }), { ok: false, error: MATCH_REPORT_REASON_ERROR });
  assert.deepEqual(parseMatchReportWrite({ reason: "spam", reporter_id: userId }), { ok: false, error: MATCH_REPORT_REASON_ERROR });
  assert.deepEqual(parseMatchReportWrite({ reason: "spam", message_id: "bad-id" }), { ok: false, error: MATCH_REPORT_MESSAGE_NOT_FOUND });
});

test("a matched member reads the conversation oldest first and receives block status", async () => {
  const calls = installFetch({ blockStatus: { is_blocked: false, blocked_by_me: false } });
  const result = await request("GET", `/api/matches/${matchId}/messages`, { cookie: signedSession() });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.messages, [
    { id: "m1", body: "오늘 즐거웠어요", created_at: "2026-11-24T09:00:00+00:00", is_mine: true },
    { id: "m2", body: "저도요!", created_at: "2026-11-24T09:01:00+00:00", is_mine: false },
  ]);
  assert.deepEqual(result.body.block, { is_blocked: false, blocked_by_me: false });
  assert.equal(result.raw.includes(partnerId), false);
  assert.equal(result.raw.includes("sender_id"), false);
  const [rpc] = rpcCalls(calls);
  assert.equal(rpc.authorization, "Bearer user-access-token");
  assert.match(rpc.href, /\/rpc\/list_match_messages$/);
  assert.deepEqual(JSON.parse(rpc.body), { p_match_id: matchId, p_limit: 50, p_before: null });
  const membership = calls.find((call) => call.href.includes("/rest/v1/matches"));
  assert.equal(membership.authorization, "Bearer test-service");
  assert.match(membership.href, /select=id,user_a_id,user_b_id&/);
});

test("a matched member sends a trimmed message with the user token and no client sender id", async () => {
  const calls = installFetch();
  const result = await request("POST", `/api/matches/${matchId}/messages`, {
    cookie: signedSession(),
    body: { body: "  다음에 또 운동해요  " },
  });
  assert.equal(result.status, 201);
  assert.deepEqual(result.body.message, {
    id: "m3",
    body: "다음에 또 운동해요",
    created_at: "2026-11-24T09:02:00+00:00",
    is_mine: true,
  });
  const [rpc] = rpcCalls(calls);
  assert.equal(rpc.authorization, "Bearer user-access-token");
  assert.match(rpc.href, /\/rpc\/send_match_message$/);
  assert.deepEqual(JSON.parse(rpc.body), { p_match_id: matchId, p_body: "다음에 또 운동해요" });
});

test("a signed-in user who is not in the match cannot read, send, block, unblock, or report", async () => {
  for (const [method, path, body] of [
    ["GET", `/api/matches/${otherMatchId}/messages`, undefined],
    ["POST", `/api/matches/${otherMatchId}/messages`, { body: "끼어들기" }],
    ["POST", `/api/matches/${otherMatchId}/block`, undefined],
    ["DELETE", `/api/matches/${otherMatchId}/block`, undefined],
    ["POST", `/api/matches/${otherMatchId}/reports`, { reason: "spam" }],
  ]) {
    const calls = installFetch();
    const res = await request(method, path, { cookie: signedSession(), body });
    assert.equal(res.status, 403);
    assert.equal(res.body.error, MATCH_CHAT_FORBIDDEN);
    assert.equal(rpcCalls(calls).length, 0);
  }
});

test("anonymous requests are refused before any database call", async () => {
  const calls = installFetch();
  for (const [method, path, body] of [
    ["GET", `/api/matches/${matchId}/messages`, undefined],
    ["POST", `/api/matches/${matchId}/messages`, { body: "hi" }],
    ["POST", `/api/matches/${matchId}/block`, undefined],
    ["DELETE", `/api/matches/${matchId}/block`, undefined],
    ["POST", `/api/matches/${matchId}/reports`, { reason: "spam" }],
    ["GET", "/api/admin/match-reports", undefined],
  ]) {
    const res = await request(method, path, { body });
    assert.equal(res.status, 401);
  }
  assert.equal(calls.some((call) => call.href.includes("/rest/v1/")), false);
});

test("an unmatched pair has no conversation: unknown or malformed match ids are not found", async () => {
  let calls = installFetch();
  const missing = await request("POST", `/api/matches/${missingMatchId}/messages`, {
    cookie: signedSession(),
    body: { body: "hi" },
  });
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error, MATCH_NOT_FOUND);
  assert.equal(rpcCalls(calls).length, 0);

  calls = installFetch();
  const malformed = await request("GET", "/api/matches/not-a-uuid/messages", { cookie: signedSession() });
  assert.equal(malformed.status, 404);
  assert.equal(calls.some((call) => call.href.includes("/rest/v1/matches") || call.href.includes("/rpc/")), false);
});

test("block, unblock, and blocked send errors map cleanly with the user token", async () => {
  let calls = installFetch();
  const blocked = await request("POST", `/api/matches/${matchId}/block`, { cookie: signedSession() });
  assert.equal(blocked.status, 200);
  assert.deepEqual(blocked.body, { block: { is_blocked: true, blocked_by_me: true } });
  assert.match(rpcCalls(calls)[0].href, /\/rpc\/block_match_chat$/);
  assert.equal(rpcCalls(calls)[0].authorization, "Bearer user-access-token");

  installFetch({ rpcStatus: 403, rpcMessage: "match_chat_blocked" });
  const sendBlocked = await request("POST", `/api/matches/${matchId}/messages`, {
    cookie: signedSession(),
    body: { body: "차단됨" },
  });
  assert.equal(sendBlocked.status, 403);
  assert.equal(sendBlocked.body.error, MATCH_CHAT_BLOCKED);

  installFetch({ rpcStatus: 403, rpcMessage: "match_chat_unblock_forbidden" });
  const unblockDenied = await request("DELETE", `/api/matches/${matchId}/block`, { cookie: signedSession() });
  assert.equal(unblockDenied.status, 403);
  assert.equal(unblockDenied.body.error, MATCH_CHAT_UNBLOCK_FORBIDDEN);

  calls = installFetch();
  const unblocked = await request("DELETE", `/api/matches/${matchId}/block`, { cookie: signedSession() });
  assert.equal(unblocked.status, 200);
  assert.deepEqual(unblocked.body, { block: { is_blocked: false, blocked_by_me: false } });
  assert.match(rpcCalls(calls)[0].href, /\/rpc\/unblock_match_chat$/);
});

test("reports submit with user token, reject bad payloads, and admin reports require is_admin", async () => {
  let calls = installFetch();
  const created = await request("POST", `/api/matches/${matchId}/reports`, {
    cookie: signedSession(),
    body: { reason: "harassment", detail: "  욕설  ", message_id: messageUuid },
  });
  assert.equal(created.status, 201);
  assert.deepEqual(created.body, { report: { id: "r-new", created_at: "2026-11-25T00:01:00+00:00" } });
  const [rpc] = rpcCalls(calls);
  assert.equal(rpc.authorization, "Bearer user-access-token");
  assert.deepEqual(JSON.parse(rpc.body), {
    p_match_id: matchId,
    p_reason: "harassment",
    p_detail: "욕설",
    p_message_id: messageUuid,
  });

  installFetch({ rpcStatus: 400, rpcMessage: "report_message_not_found" });
  const missingMsg = await request("POST", `/api/matches/${matchId}/reports`, {
    cookie: signedSession(),
    body: { reason: "spam", message_id: messageUuid },
  });
  assert.equal(missingMsg.status, 404);
  assert.equal(missingMsg.body.error, MATCH_REPORT_MESSAGE_NOT_FOUND);

  calls = installFetch({ isAdmin: false });
  const nonAdminList = await request("GET", "/api/admin/match-reports", { cookie: signedSession() });
  assert.equal(nonAdminList.status, 403);
  assert.equal(calls.some((call) => call.href.includes("match_chat_reports")), false);

  calls = installFetch({ isAdmin: true });
  const adminList = await request("GET", "/api/admin/match-reports", { cookie: signedSession() });
  assert.equal(adminList.status, 200);
  assert.equal(adminList.body.reports.length, 1);
  const reportRead = calls.find((call) => call.href.includes("match_chat_reports"));
  assert.equal(reportRead?.authorization, "Bearer user-access-token");
});

test("rate limit errors map to 429 with clear Korean messages", async () => {
  installFetch({ rpcStatus: 400, rpcMessage: "match_chat_rate_limit_minute" });
  const minuteLimited = await request("POST", `/api/matches/${matchId}/messages`, {
    cookie: signedSession(),
    body: { body: "빠른 메시지" },
  });
  assert.equal(minuteLimited.status, 429);
  assert.equal(minuteLimited.body.error, MATCH_CHAT_RATE_LIMIT_MINUTE);

  installFetch({ rpcStatus: 400, rpcMessage: "match_chat_rate_limit_day" });
  const dayLimited = await request("POST", `/api/matches/${matchId}/messages`, {
    cookie: signedSession(),
    body: { body: "하루 초과" },
  });
  assert.equal(dayLimited.status, 429);
  assert.equal(dayLimited.body.error, MATCH_CHAT_RATE_LIMIT_DAY);
});

test("a matched pair the database blocks (class not over or attendance reversed) gets 403", async () => {
  installFetch({ rpcStatus: 403, rpcMessage: "match_chat_forbidden" });
  const read = await request("GET", `/api/matches/${matchId}/messages`, { cookie: signedSession() });
  assert.equal(read.status, 403);
  assert.equal(read.body.error, MATCH_CHAT_FORBIDDEN);
  const sent = await request("POST", `/api/matches/${matchId}/messages`, {
    cookie: signedSession(),
    body: { body: "닫힌 대화" },
  });
  assert.equal(sent.status, 403);
  assert.equal(sent.body.error, MATCH_CHAT_FORBIDDEN);
});

test("the message length limit is enforced on the server and mapped from the database", async () => {
  let calls = installFetch();
  const tooLong = await request("POST", `/api/matches/${matchId}/messages`, {
    cookie: signedSession(),
    body: { body: "가".repeat(1001) },
  });
  assert.equal(tooLong.status, 400);
  assert.equal(tooLong.body.error, MATCH_MESSAGE_TEXT_ERROR);
  const blank = await request("POST", `/api/matches/${matchId}/messages`, {
    cookie: signedSession(),
    body: { body: "   " },
  });
  assert.equal(blank.status, 400);
  assert.equal(rpcCalls(calls).length, 0);

  calls = installFetch();
  const max = await request("POST", `/api/matches/${matchId}/messages`, {
    cookie: signedSession(),
    body: { body: "가".repeat(1000) },
  });
  assert.equal(max.status, 201);
  assert.equal(max.body.message.body.length, 1000);

  installFetch({ rpcStatus: 400, rpcMessage: "message_invalid" });
  const dbRejected = await request("POST", `/api/matches/${matchId}/messages`, {
    cookie: signedSession(),
    body: { body: "hi" },
  });
  assert.equal(dbRejected.status, 400);
  assert.equal(dbRejected.body.error, MATCH_MESSAGE_TEXT_ERROR);
});

test("a bad before cursor is rejected and the announcement inbox still answers", async () => {
  installFetch();
  const bad = await request("GET", `/api/matches/${matchId}/messages?before=yesterday`, { cookie: signedSession() });
  assert.equal(bad.status, 400);
  const calls = installFetch();
  globalThis.fetch = ((original) => async (url, init) => {
    const href = String(url);
    if (href.includes("/rest/v1/announcements") || href.includes("/rest/v1/owner_notice_acknowledgements")) {
      return Response.json([]);
    }
    return original(url, init);
  })(globalThis.fetch);
  const inbox = await request("GET", "/api/messages", { cookie: signedSession() });
  assert.equal(inbox.status, 200);
  assert.deepEqual(inbox.body, { announcements: [] });
  assert.equal(calls.some((call) => call.href.includes("match_messages")), false);
});
