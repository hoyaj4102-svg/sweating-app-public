import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  clearRecoveryLink,
  currentRecoveryLink,
  discardSignupLink,
  isSignupLink,
  parseRecoveryLink,
  recoveryUrlWithoutSecrets,
  rememberRecoveryLink,
  signupUrlWithoutSecrets,
} from "./recovery-link.ts";

const TOKEN = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.signature";
const SECRETS = ["access_token", "refresh_token", "provider_token", "provider_refresh_token", "token_hash", "token", "expires_at", "expires_in", "token_type", "type"];

type Write = { kind: string; args: unknown[] };

function fakeStorage(writes: Write[], name: string): Storage {
  const data = new Map<string, string>();
  return {
    get length() { return data.size; },
    clear() { writes.push({ kind: `${name}.clear`, args: [] }); data.clear(); },
    getItem(key: string) { return data.get(key) ?? null; },
    key(index: number) { return [...data.keys()][index] ?? null; },
    removeItem(key: string) { writes.push({ kind: `${name}.removeItem`, args: [key] }); data.delete(key); },
    setItem(key: string, value: string) { writes.push({ kind: `${name}.setItem`, args: [key, value] }); data.set(key, value); },
  };
}

function fakeBrowser(href: string) {
  const writes: Write[] = [];
  const requests: string[] = [];
  let cookie = "";
  const url = new URL(href);
  const location = {
    get href() { return url.href; },
    get hash() { return url.hash; },
    get search() { return url.search; },
  };
  const history = {
    state: { from: "test" } as unknown,
    calls: [] as Array<{ state: unknown; url: string }>,
    replaceState(state: unknown, _unused: string, next?: string | URL | null) {
      const resolved = new URL(String(next), url.href);
      history.calls.push({ state, url: String(next) });
      url.href = resolved.href;
    },
  };
  const globals = globalThis as Record<string, unknown>;
  const saved = {
    localStorage: Object.getOwnPropertyDescriptor(globals, "localStorage"),
    sessionStorage: Object.getOwnPropertyDescriptor(globals, "sessionStorage"),
    document: Object.getOwnPropertyDescriptor(globals, "document"),
    fetch: globalThis.fetch,
  };
  const localStorage = fakeStorage(writes, "localStorage");
  const sessionStorage = fakeStorage(writes, "sessionStorage");
  Object.defineProperty(globals, "localStorage", { configurable: true, value: localStorage });
  Object.defineProperty(globals, "sessionStorage", { configurable: true, value: sessionStorage });
  Object.defineProperty(globals, "document", {
    configurable: true,
    value: {
      get cookie() { return cookie; },
      set cookie(value: string) { writes.push({ kind: "document.cookie", args: [value] }); cookie = value; },
    },
  });
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    requests.push(String(input));
    throw new Error("no network in tests");
  }) as typeof fetch;
  const restore = () => {
    for (const key of ["localStorage", "sessionStorage", "document"] as const) {
      const descriptor = saved[key];
      if (descriptor) Object.defineProperty(globals, key, descriptor);
      else delete globals[key];
    }
    globalThis.fetch = saved.fetch;
  };
  return { target: { location, history }, history, writes, requests, localStorage, sessionStorage, cookie: () => cookie, restore };
}

function assertNoSecrets(href: string): void {
  const url = new URL(href);
  const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
  for (const key of SECRETS) {
    assert.equal(url.searchParams.has(key), false, `query ${key}`);
    assert.equal(hash.has(key), false, `hash ${key}`);
  }
  assert.equal(href.includes(TOKEN), false);
  assert.equal(href.includes("refresh-secret"), false);
}

test("a signup hash is detected and is not a recovery link", () => {
  const hash = `#access_token=${TOKEN}&refresh_token=refresh-secret&expires_at=1&expires_in=3600&token_type=bearer&type=signup`;
  assert.equal(parseRecoveryLink(hash, "").kind, "absent");
  assert.equal(isSignupLink(hash, ""), true);
  assert.equal(isSignupLink("", `?token_hash=abc&type=signup`), true);
  assert.equal(isSignupLink(`#access_token=${TOKEN}&type=recovery`, ""), false);
  assert.equal(isSignupLink("#section", "?next=/classes/x"), false);
  assert.equal(isSignupLink("", "?oauth_error=hello"), false);
  assert.equal(isSignupLink("", "?code=oauth-code&state=s"), false);
});

test("signup hash secrets are stripped with replaceState on any landing page, without sign-in or storage", () => {
  for (const path of ["/", "/login", "/home", "/classes/abc", "/profile"]) {
    const browser = fakeBrowser(
      `https://app.example.com${path}?utm_source=mail#access_token=${TOKEN}&refresh_token=refresh-secret&provider_token=p&provider_refresh_token=pr&expires_at=1&expires_in=3600&token_type=bearer&type=signup`,
    );
    try {
      clearRecoveryLink();
      assert.equal(discardSignupLink(browser.target), true);
      assert.equal(browser.history.calls.length, 1);
      assert.deepEqual(browser.history.calls[0].state, { from: "test" });
      const after = browser.target.location.href;
      assertNoSecrets(after);
      assert.equal(after, `https://app.example.com${path}?utm_source=mail`);
      assert.deepEqual(browser.requests, []);
      assert.deepEqual(browser.writes, []);
      assert.equal(browser.localStorage.length, 0);
      assert.equal(browser.sessionStorage.length, 0);
      assert.equal(browser.cookie(), "");
      assert.equal(currentRecoveryLink().kind, "absent");
      // Running again is a no-op once the URL is clean.
      assert.equal(discardSignupLink(browser.target), false);
      assert.equal(browser.history.calls.length, 1);
    } finally {
      browser.restore();
    }
  }
});

test("signup query secrets are stripped and unrelated params and fragments are kept", () => {
  const stripped = signupUrlWithoutSecrets(`/login?token_hash=abc&token=123456&type=signup&next=/home#section`);
  assert.equal(stripped, "/login?next=%2Fhome#section");
  const hashOnly = signupUrlWithoutSecrets(`https://app.example.com/?next=/home#access_token=${TOKEN}&type=signup&keep=1`);
  assert.equal(hashOnly, "https://app.example.com/?next=/home#keep=1");
  const bareType = signupUrlWithoutSecrets("https://app.example.com/#type=signup");
  assert.equal(bareType, "https://app.example.com/");
  // OAuth callback params and plain links are left alone.
  assert.equal(signupUrlWithoutSecrets("/login?oauth_error=hello#section"), "/login?oauth_error=hello#section");
  assert.equal(signupUrlWithoutSecrets("/?code=oauth-code&state=s"), "/?code=oauth-code&state=s");
});

test("a recovery link is not touched by the signup strip and keeps its reset flow", () => {
  const href = `https://app.example.com/#access_token=${TOKEN}&refresh_token=refresh-secret&type=recovery`;
  const browser = fakeBrowser(href);
  try {
    clearRecoveryLink();
    assert.equal(signupUrlWithoutSecrets(href), href);
    assert.equal(discardSignupLink(browser.target), false);
    assert.equal(browser.history.calls.length, 0);

    // The existing recovery capture: parse, remember in memory, strip the URL.
    const parsed = parseRecoveryLink(browser.target.location.hash, browser.target.location.search);
    assert.deepEqual(parsed, { kind: "ready", accessToken: TOKEN });
    rememberRecoveryLink(parsed);
    browser.target.history.replaceState(browser.history.state, "", recoveryUrlWithoutSecrets(browser.target.location.href));
    assertNoSecrets(browser.target.location.href);
    assert.deepEqual(currentRecoveryLink(), { kind: "ready", accessToken: TOKEN });
    assert.deepEqual(browser.writes, []);
    assert.deepEqual(browser.requests, []);
    assert.equal(browser.localStorage.length + browser.sessionStorage.length, 0);
    assert.equal(browser.cookie(), "");
  } finally {
    clearRecoveryLink();
    browser.restore();
  }
});

test("expired or invalid links keep the existing error handling", () => {
  const expired = "#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired";
  assert.equal(parseRecoveryLink(expired, "").kind, "invalid");
  assert.equal(isSignupLink(expired, ""), false);
  assert.equal(signupUrlWithoutSecrets(`https://app.example.com/${expired}`), `https://app.example.com/${expired}`);
  assert.equal(parseRecoveryLink(`#type=recovery&access_token=${"a".repeat(30)}`, "").kind, "invalid");
});

test("the strip runs before the first render and from the global redirect, and the reset form keeps its rules", () => {
  const main = readFileSync(new URL("../main.tsx", import.meta.url), "utf8");
  const discardAt = main.indexOf("discardSignupLink();");
  assert.ok(discardAt > 0 && discardAt < main.indexOf("createRoot("));

  const reset = readFileSync(new URL("./password-reset.tsx", import.meta.url), "utf8");
  const redirect = reset.slice(reset.indexOf("export function RecoveryLinkRedirect"), reset.indexOf("export function ForgotPasswordScreen"));
  assert.match(redirect, /if \(parsed\.kind === "absent"\) \{\s*\/\/[^\n]*\n\s*discardSignupLink\(\);\s*return;\s*\}/);
  assert.match(redirect, /window\.addEventListener\("hashchange", capture\)/);
  // The reset submit still sends the remembered token, and the form requires the shared password rule.
  assert.match(reset, /resetPassword\(\{ access_token: link\.accessToken, password \}\)/);
  assert.match(reset, /validateNewPassword\(password\)/);
  assert.equal(reset.match(/minLength=\{10\}/g)?.length, 2);

  // No auth code in the frontend stores tokens in web storage or document.cookie.
  const files = ["../App.tsx", "../main.tsx", "./password-reset.tsx", "./recovery-link.ts", "./social-login.ts", "./user-message.ts"];
  for (const file of files) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.equal(/localStorage|sessionStorage|document\.cookie/.test(source), false, file);
  }
  const link = readFileSync(new URL("./recovery-link.ts", import.meta.url), "utf8");
  const discard = link.slice(link.indexOf("export function discardSignupLink"));
  assert.equal(/fetch\(|getCurrentUser|remember/.test(discard), false);
});
