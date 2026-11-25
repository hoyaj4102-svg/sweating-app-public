import assert from "node:assert/strict";
import test from "node:test";
import { buildSentryRuntimeOptions, createInternalUserId, sentryEnvironment } from "../src/options.ts";
import { scrubBeforeBreadcrumb, scrubBeforeSend, scrubBeforeSendTransaction } from "../src/scrub.ts";

const FAKE_PASSWORD = "fake-password";
const FAKE_JWT = "eyJhbGciOiJub25lIn0.eyJzdWIiOiJ0ZXN0In0.fake-signature";
const FAKE_CARD = "4242424242424242";
const FAKE_CARD_SPACED = "4242 4242 4242 4242";
const FAKE_EMAIL = "person@example.com";
const FAKE_PHONE = "010-0000-0000";
const FAKE_CHAT = "fake-chat-text-not-real";
const FAKE_CODE = "fake-oauth-code";
const FAKE_KEY = "fake-query-key";
const FAKE_API_KEY = "fake-api-key";
const FAKE_TOKEN_HEADER = "fake-token-value";
const FAKE_COOKIE = "fake-session-cookie";
const FAKE_IP = "203.0.113.5";
const INTERNAL_ID = "anon-test";

const SECRETS = [
  FAKE_PASSWORD,
  FAKE_JWT,
  FAKE_CARD,
  FAKE_CARD_SPACED,
  FAKE_EMAIL,
  FAKE_PHONE,
  FAKE_CHAT,
  FAKE_CODE,
  FAKE_KEY,
  FAKE_API_KEY,
  FAKE_TOKEN_HEADER,
  FAKE_COOKIE,
  FAKE_IP,
];

function plantedEvent() {
  return {
    message: `boom password=${FAKE_PASSWORD} jwt=${FAKE_JWT}`,
    exception: {
      values: [
        {
          type: "Error",
          value: `send failed message: ${FAKE_CHAT} card ${FAKE_CARD} spaced ${FAKE_CARD_SPACED} mail ${FAKE_EMAIL} phone ${FAKE_PHONE}`,
        },
      ],
    },
    request: {
      url: `https://app.example.com/api/messages?token=${FAKE_JWT}&code=${FAKE_CODE}&key=${FAKE_KEY}&ok=1`,
      query_string: `token=${FAKE_JWT}&code=${FAKE_CODE}&ok=1`,
      headers: {
        Authorization: `Bearer ${FAKE_JWT}`,
        apikey: FAKE_API_KEY,
        "X-Access-Token": FAKE_TOKEN_HEADER,
        "X-Forwarded-For": FAKE_IP,
        Cookie: FAKE_COOKIE,
        "Content-Type": "application/json",
      },
      cookies: { swetin_session: FAKE_COOKIE },
      data: {
        password: FAKE_PASSWORD,
        text: FAKE_CHAT,
        email: FAKE_EMAIL,
        phone: FAKE_PHONE,
      },
    },
    breadcrumbs: [
      { category: "console", level: "debug", message: `debug ${FAKE_CHAT}` },
      {
        category: "console",
        level: "log",
        message: `log password=${FAKE_PASSWORD}`,
      },
      {
        category: "console",
        level: "error",
        message: `error password=${FAKE_PASSWORD} ${FAKE_EMAIL} message: ${FAKE_CHAT}`,
        data: { text: FAKE_CHAT, url: `https://example.com/a?token=${FAKE_TOKEN_HEADER}` },
      },
      {
        category: "fetch",
        level: "info",
        message: "POST /api/messages",
        data: { body: FAKE_CHAT, request_body: { password: FAKE_PASSWORD } },
      },
    ],
    extra: {
      password: FAKE_PASSWORD,
      chat: FAKE_CHAT,
      text: FAKE_CHAT,
      note: `contact ${FAKE_EMAIL} ${FAKE_PHONE} ${FAKE_CARD} ${FAKE_JWT} message: ${FAKE_CHAT}`,
    },
    user: {
      id: FAKE_EMAIL,
      email: FAKE_EMAIL,
      username: "Ada Example",
      ip_address: FAKE_IP,
    },
  };
}

test("beforeSend removes planted secrets from the body, headers, breadcrumbs, exception, and extra", () => {
  const result = scrubBeforeSend(plantedEvent(), { internalUserId: INTERNAL_ID });
  assert.ok(result);
  const serialized = JSON.stringify(result);
  for (const secret of SECRETS) {
    assert.equal(serialized.includes(secret), false);
  }
  assert.equal(result.user.id, INTERNAL_ID);
  assert.equal("email" in result.user, false);
  assert.equal("username" in result.user, false);
  assert.equal("ip_address" in result.user, false);
  assert.equal(result.request.data, undefined);
  assert.equal(result.request.cookies, undefined);
  assert.equal(result.request.body, undefined);
  assert.equal(result.request.headers.Authorization, undefined);
  assert.equal(result.request.headers.apikey, undefined);
  assert.equal(result.request.headers["X-Access-Token"], undefined);
  assert.equal(result.request.headers["X-Forwarded-For"], undefined);
  assert.equal(result.request.headers.Cookie, undefined);
  assert.equal(result.request.headers["Content-Type"], "application/json");
  assert.match(result.request.url, /ok=1/);
  assert.doesNotMatch(result.request.url, /token=/);
  assert.doesNotMatch(result.request.query_string, /token=/);
  const levels = result.breadcrumbs.map((breadcrumb) => breadcrumb.level);
  assert.deepEqual(levels, ["error", "info"]);
  assert.equal(result.extra.password, "[redacted]");
  assert.equal(result.extra.chat, "[redacted]");
  assert.equal(result.extra.text, "[redacted]");
});

test("beforeSendTransaction uses the same removal rules", () => {
  const result = scrubBeforeSendTransaction(
    {
      transaction: `POST /api/messages?token=${FAKE_JWT}&ok=1`,
      request: { data: { text: FAKE_CHAT, password: FAKE_PASSWORD }, url: "https://app.example.com/api/messages" },
      extra: { message: FAKE_CHAT, note: FAKE_EMAIL },
    },
    { internalUserId: INTERNAL_ID },
  );
  assert.ok(result);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(FAKE_JWT), false);
  assert.equal(serialized.includes(FAKE_CHAT), false);
  assert.equal(serialized.includes(FAKE_PASSWORD), false);
  assert.equal(serialized.includes(FAKE_EMAIL), false);
  assert.equal(result.request.data, undefined);
  assert.match(result.transaction, /ok=1/);
  assert.equal(result.user.id, INTERNAL_ID);
});

test("beforeBreadcrumb keeps only error console crumbs and strips their secrets", () => {
  assert.equal(
    scrubBeforeBreadcrumb({ category: "console", level: "info", message: `message: ${FAKE_CHAT}` }),
    null,
  );
  const kept = scrubBeforeBreadcrumb({
    category: "console",
    level: "error",
    message: `message: ${FAKE_CHAT} ${FAKE_EMAIL}`,
    data: { body: FAKE_CHAT, password: FAKE_PASSWORD },
  });
  assert.ok(kept);
  const serialized = JSON.stringify(kept);
  assert.equal(serialized.includes(FAKE_CHAT), false);
  assert.equal(serialized.includes(FAKE_EMAIL), false);
  assert.equal(serialized.includes(FAKE_PASSWORD), false);
  assert.equal(kept.data.body, "[redacted]");
  assert.equal(kept.data.password, "[redacted]");
});

test("beforeSend drops the event when scrubbing throws", () => {
  const extra: Record<string, unknown> = {};
  Object.defineProperty(extra, "note", {
    enumerable: true,
    get() {
      throw new Error("scrub-failed");
    },
  });
  assert.equal(scrubBeforeSend({ extra }, { internalUserId: INTERNAL_ID }), null);
});

test("runtime options stay off without a DSN and do not infer preview from a vercel.app host", () => {
  const disabled = buildSentryRuntimeOptions({ dsn: "  ", vercelEnv: undefined, release: "  " });
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.dsn, undefined);
  assert.equal(disabled.sendDefaultPii, false);
  assert.equal(disabled.tracesSampleRate, 0.1);
  assert.equal(disabled.replaysSessionSampleRate, 0);
  assert.equal(disabled.replaysOnErrorSampleRate, 0);
  assert.equal(disabled.enableLogs, false);
  assert.equal(disabled.includeLocalVariables, false);
  assert.equal(disabled.environment, "development");
  assert.equal(disabled.release, undefined);

  const enabled = buildSentryRuntimeOptions({
    dsn: "test-dsn",
    vercelEnv: "production",
    release: "abc123",
  });
  assert.equal(enabled.enabled, true);
  assert.equal(enabled.environment, "production");
  assert.equal(enabled.release, "abc123");
  assert.equal(sentryEnvironment("preview"), "preview");
  assert.equal(sentryEnvironment("https://app.example.com"), "development");
  assert.equal(sentryEnvironment("app.example.com"), "development");
  assert.equal(sentryEnvironment("*.vercel.app"), "development");
});

test("internal id is an anon token rather than an email or uuid", () => {
  const id = createInternalUserId(() => 1);
  assert.match(id, /^anon-[a-z0-9]{16}$/);
  assert.equal(id.includes("@"), false);
  assert.equal(id.split("-").length, 2);
});
