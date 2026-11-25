import assert from "node:assert/strict";
import test from "node:test";
import { resolveViteDevSettings } from "./dev-server.ts";

test("vite dev settings default without Replit env", () => {
  assert.deepEqual(resolveViteDevSettings({}), {
    port: 5173,
    basePath: "/",
    apiProxyTarget: "http://127.0.0.1:8787",
  });
  assert.deepEqual(resolveViteDevSettings({ PORT: " ", BASE_PATH: "", API_PROXY_TARGET: "" }), {
    port: 5173,
    basePath: "/",
    apiProxyTarget: "http://127.0.0.1:8787",
  });
});

test("vite dev settings keep explicit port, base path, and proxy target", () => {
  assert.deepEqual(
    resolveViteDevSettings({
      PORT: "26077",
      BASE_PATH: "/app/",
      API_PROXY_TARGET: "http://127.0.0.1:9000",
    }),
    { port: 26077, basePath: "/app/", apiProxyTarget: "http://127.0.0.1:9000" },
  );
});

test("vite dev settings reject an invalid port", () => {
  assert.throws(() => resolveViteDevSettings({ PORT: "0" }), /Invalid PORT/);
  assert.throws(() => resolveViteDevSettings({ PORT: "nope" }), /Invalid PORT/);
});
