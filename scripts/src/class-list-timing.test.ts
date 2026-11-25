import assert from "node:assert/strict";
import test from "node:test";
import {
  attributeLatency,
  classListUrl,
  measureClassList,
  parseCli,
  parseServerTiming,
  readOnlyClassListRequest,
  regionFromVercelId,
  summarize,
} from "./class-list-timing.ts";

test("nearest-rank percentiles and the mean use the sample values", () => {
  const summary = summarize([10, 20, 30, 40, 100]);
  assert.deepEqual(summary, { n: 5, mean: 40, p50: 30, p95: 100 });
});

test("only an anonymous class-list URL is accepted", () => {
  assert.equal(classListUrl("https://example.vercel.app/api/classes").hostname, "example.vercel.app");
  assert.equal(classListUrl("http://127.0.0.1:8787/api/classes").protocol, "http:");
  for (const raw of [
    "https://example.vercel.app/api/classes?sport=run",
    "https://example.vercel.app/api/classes/abc",
    "https://user:secret@example.vercel.app/api/classes",
    "https://example.com/api/classes",
    "http://example.vercel.app/api/classes",
    "https://example.vercel.app/api/auth/login",
  ]) {
    assert.throws(() => classListUrl(raw), raw);
  }
});

test("the request plan is GET with no cookie or authorization", () => {
  const planned = readOnlyClassListRequest(classListUrl("https://preview.vercel.app/api/classes"));
  assert.equal(planned.method, "GET");
  assert.deepEqual(Object.keys(planned.headers).sort(), ["accept", "cache-control"]);
  assert.equal(JSON.stringify(planned).toLowerCase().includes("cookie"), false);
  assert.equal(JSON.stringify(planned).toLowerCase().includes("authorization"), false);
});

test("server timing and region parsing keep durations and drop the rest of the id", () => {
  const timing = parseServerTiming('cdn-cache;desc="MISS", auth;dur=1.5;desc="n=0", db;dur=420.0;desc="n=2", total;dur=430.0');
  assert.equal(timing.db?.dur, 420);
  assert.equal(timing.db?.desc, "n=2");
  assert.equal(timing.auth?.dur, 1.5);
  assert.equal(regionFromVercelId("hnd1::hnd1::deployment-id"), "hnd1");
  assert.equal(regionFromVercelId("not a region"), null);
});

test("attribution compares database time with the client total", () => {
  assert.equal(attributeLatency(570, 520), "db_roundtrip");
  assert.equal(attributeLatency(570, 40), "outside_db");
  assert.equal(attributeLatency(570, 250), "mixed");
  assert.equal(attributeLatency(null, 40), "unknown");
});

test("cli flags cannot turn the read into a write", () => {
  assert.throws(() => parseCli(["--method", "POST", "--before", "https://example.vercel.app/api/classes"], {}));
  assert.throws(() => parseCli(["--cookie", "session=1"], {}));
  const parsed = parseCli(["--before", "https://a.vercel.app/api/classes", "--samples", "5"], {});
  assert.equal(parsed.samples, 5);
  assert.equal(parsed.before, "https://a.vercel.app/api/classes");
});

test("measurement sends only GET and discards the body", async () => {
  const calls: Array<{ method: string; cookie: string | null; authorization: string | null }> = [];
  let clock = 0;
  const report = await measureClassList("http://127.0.0.1:9/api/classes", {
    samples: 3,
    pauseMs: 0,
    now: () => {
      clock += 100;
      return clock;
    },
    fetchImpl: async (_url, init) => {
      const headers = new Headers(init?.headers);
      calls.push({
        method: init?.method ?? "GET",
        cookie: headers.get("cookie"),
        authorization: headers.get("authorization"),
      });
      assert.equal(init?.body, undefined);
      assert.equal(init?.redirect, "manual");
      return new Response("[{\"id\":\"33333333-3333-4333-8333-333333333333\",\"title\":\"kept-out\"}]", {
        status: 200,
        headers: {
          "content-type": "application/json",
          "server-timing": 'auth;dur=0.0;desc="n=0", db;dur=80.0;desc="n=2", total;dur=90.0',
          "x-vercel-id": "iad1::secret-deployment",
          "x-vercel-cache": "MISS",
        },
      });
    },
  });
  assert.equal(calls.length, 4);
  assert.equal(calls.every((call) => call.method === "GET" && call.cookie === null && call.authorization === null), true);
  assert.equal(report.outcome, "measured");
  assert.equal(report.samples, 3);
  assert.equal(report.warmup_excluded, 1);
  assert.equal(report.region, "iad1");
  assert.equal(report.db_ms?.mean, 80);
  assert.equal(report.client_ms?.n, 3);
  assert.equal(report.attribution, "db_roundtrip");
  const encoded = JSON.stringify(report);
  assert.equal(encoded.includes("33333333"), false);
  assert.equal(encoded.includes("kept-out"), false);
  assert.equal(encoded.includes("secret-deployment"), false);
});

test("a protection redirect is unknown and is not followed", async () => {
  let calls = 0;
  const report = await measureClassList("https://preview.vercel.app/api/classes", {
    samples: 5,
    pauseMs: 0,
    fetchImpl: async () => {
      calls += 1;
      return new Response("<html>login</html>", {
        status: 302,
        headers: { location: "https://vercel.com/login", "content-type": "text/html" },
      });
    },
  });
  assert.equal(calls, 1);
  assert.equal(report.outcome, "unknown");
  assert.equal(report.reason, "redirect");
  assert.equal(report.attribution, "unknown");
  assert.equal(JSON.stringify(report).includes("vercel.com"), false);
});
