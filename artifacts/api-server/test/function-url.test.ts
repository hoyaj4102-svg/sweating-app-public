import assert from "node:assert/strict";
import test from "node:test";
import { normalizeFunctionUrl } from "../src/function-url.ts";

test("function URLs keep an existing /api prefix and query", () => {
  assert.equal(normalizeFunctionUrl("/api/healthz"), "/api/healthz");
  assert.equal(normalizeFunctionUrl("/api/auth/me?x=1"), "/api/auth/me?x=1");
  assert.equal(normalizeFunctionUrl("/api"), "/api");
});

test("function URLs add the /api prefix when the platform strips it", () => {
  assert.equal(normalizeFunctionUrl("/"), "/api");
  assert.equal(normalizeFunctionUrl(undefined), "/api");
  assert.equal(normalizeFunctionUrl("/auth/me"), "/api/auth/me");
  assert.equal(normalizeFunctionUrl("auth/me?x=1"), "/api/auth/me?x=1");
});

test("collapsed /api rewrite restores the nested path and drops the synthetic query", () => {
  assert.equal(normalizeFunctionUrl("/api?path=auth/session"), "/api/auth/session");
  assert.equal(normalizeFunctionUrl("/api/?path=auth/login"), "/api/auth/login");
  assert.equal(
    normalizeFunctionUrl("/api?path=admin/classes/class-1/participants/user-1/attendance&x=1"),
    "/api/admin/classes/class-1/participants/user-1/attendance?x=1",
  );
  assert.equal(normalizeFunctionUrl("/api?x=1&path=classes/abc"), "/api/classes/abc?x=1");
  assert.equal(normalizeFunctionUrl("/api/classes?path=classes"), "/api/classes?path=classes");
  assert.equal(normalizeFunctionUrl("/api?path=../secret"), "/api?path=../secret");
  assert.equal(normalizeFunctionUrl("/api?path="), "/api?path=");
});
