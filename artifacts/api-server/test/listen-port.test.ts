import assert from "node:assert/strict";
import test from "node:test";
import { resolveListenPort } from "../src/listen-port.ts";

test("development listens on the Vite proxy port when PORT is unset", () => {
  assert.equal(resolveListenPort({ NODE_ENV: "development" }), 8787);
  assert.equal(resolveListenPort({}), 8787);
});

test("an explicit PORT is kept", () => {
  assert.equal(resolveListenPort({ NODE_ENV: "production", PORT: "8080" }), 8080);
});

test("production refuses to listen when PORT is missing", () => {
  assert.throws(
    () => resolveListenPort({ NODE_ENV: "production" }),
    /PORT environment variable is required/,
  );
});

test("invalid ports are rejected", () => {
  assert.throws(() => resolveListenPort({ PORT: "0" }), /Invalid PORT/);
  assert.throws(() => resolveListenPort({ PORT: "70000" }), /Invalid PORT/);
  assert.throws(() => resolveListenPort({ PORT: "abc" }), /Invalid PORT/);
});
