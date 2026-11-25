import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import express from "express";
import {
  LOCAL_DEV_ORIGINS,
  createCorsMiddleware,
  isOriginAllowed,
  resolveCorsPolicy,
} from "../src/lib/cors.ts";

const entry = fileURLToPath(new URL("../dist/index.mjs", import.meta.url));
const ALLOWED = "https://app.example.com";
const DENIED = "https://evil.example";

function assertCredentialed(response, origin) {
  assert.equal(response.headers.get("access-control-allow-origin"), origin);
  assert.equal(response.headers.get("access-control-allow-credentials"), "true");
  assert.notEqual(response.headers.get("access-control-allow-origin"), "*");
}

function assertNotCredentialed(response, origin) {
  assert.equal(response.headers.get("access-control-allow-credentials"), null);
  assert.notEqual(response.headers.get("access-control-allow-origin"), origin);
  assert.notEqual(response.headers.get("access-control-allow-origin"), "*");
  assert.equal(response.headers.get("access-control-allow-origin"), null);
}

async function listen(app) {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  return server;
}

async function close(server) {
  await new Promise((resolve, reject) => server.close(err => (err ? reject(err) : resolve())));
}

async function freePort() {
  const socket = createServer();
  await new Promise((resolve, reject) => {
    socket.once("error", reject);
    socket.listen(0, "127.0.0.1", resolve);
  });
  const port = socket.address().port;
  await new Promise((resolve, reject) => socket.close(err => (err ? reject(err) : resolve())));
  return port;
}

function serverEnv(port, extra = {}) {
  const env = {
    ...process.env,
    NODE_ENV: "production",
    PORT: String(port),
    SESSION_SECRET: randomBytes(48).toString("base64url"),
  };
  delete env.CORS_ALLOWED_ORIGINS;
  delete env.CORS_ALLOW_VERCEL_PREVIEWS;
  delete env.VERCEL_ENV;
  delete env.VERCEL_URL;
  delete env.VERCEL_BRANCH_URL;
  delete env.VERCEL_PROJECT_PRODUCTION_URL;
  return { ...env, ...extra };
}

async function startBuiltServer(extra) {
  const port = await freePort();
  const env = serverEnv(port, extra);
  const child = spawn(process.execPath, [entry], { env, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  let errors = "";
  child.stdout.on("data", chunk => {
    output += chunk.toString();
  });
  child.stderr.on("data", chunk => {
    errors += chunk.toString();
  });
  const deadline = Date.now() + 15000;
  while (!output.includes("Server listening") && child.exitCode === null && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.ok(output.includes("Server listening"), errors || output || "Expected the built server to listen");
  assert.ok(!output.includes(env.SESSION_SECRET) && !errors.includes(env.SESSION_SECRET));
  return {
    port,
    env,
    async stop() {
      if (child.exitCode === null) {
        await new Promise(resolve => {
          child.once("exit", resolve);
          child.kill("SIGTERM");
        });
      }
    },
  };
}

test("development defaults are local only, and other environments start closed", () => {
  const development = resolveCorsPolicy({ NODE_ENV: "development" });
  assert.deepEqual([...development.exactOrigins], [...LOCAL_DEV_ORIGINS]);
  assert.equal(development.allowVercelPreviews, false);
  for (const origin of LOCAL_DEV_ORIGINS) assert.equal(isOriginAllowed(origin, development), true);
  assert.equal(isOriginAllowed("https://localhost:5173", development), false);
  assert.equal(isOriginAllowed("http://localhost:5173.evil.example", development), false);

  const production = resolveCorsPolicy({ NODE_ENV: "production" });
  assert.equal(production.exactOrigins.size, 0);
  assert.equal(production.allowVercelPreviews, false);
  assert.equal(isOriginAllowed(LOCAL_DEV_ORIGINS[0], production), false);
  assert.equal(isOriginAllowed(DENIED, production), false);
});

test("explicit origins are normalized and an explicit list replaces local defaults", () => {
  const policy = resolveCorsPolicy({
    NODE_ENV: "development",
    CORS_ALLOWED_ORIGINS: " HTTP://LOCALHOST:5173/ , https://your-production-domain.example ",
  });
  assert.equal(isOriginAllowed("http://localhost:5173", policy), true);
  assert.equal(isOriginAllowed("https://your-production-domain.example", policy), true);
  assert.equal(isOriginAllowed("http://127.0.0.1:5173", policy), false);
  assert.equal(isOriginAllowed("https://your-project.vercel.app", policy), false);
});

test("vercel preview wildcards follow the flag and exact deployment hosts stay exact", () => {
  const preview = resolveCorsPolicy({
    NODE_ENV: "production",
    VERCEL_ENV: "preview",
    VERCEL_URL: "sweating-git-feature-team.vercel.app",
    VERCEL_PROJECT_PRODUCTION_URL: "https://your-project.vercel.app",
  });
  assert.equal(preview.allowVercelPreviews, true);
  assert.equal(isOriginAllowed("https://sweating-git-feature-team.vercel.app", preview), true);
  assert.equal(isOriginAllowed("https://your-project.vercel.app", preview), true);
  assert.equal(isOriginAllowed("https://another-preview.vercel.app", preview), true);
  assert.equal(isOriginAllowed("http://another-preview.vercel.app", preview), false);
  assert.equal(isOriginAllowed("https://vercel.app", preview), false);
  assert.equal(isOriginAllowed("https://another-preview.vercel.app.evil.example", preview), false);
  assert.equal(isOriginAllowed("https://evil.example", preview), false);

  const locked = resolveCorsPolicy({
    NODE_ENV: "production",
    VERCEL_ENV: "preview",
    CORS_ALLOW_VERCEL_PREVIEWS: "false",
    VERCEL_BRANCH_URL: "sweating-git-feature-team.vercel.app/",
  });
  assert.equal(locked.allowVercelPreviews, false);
  assert.equal(isOriginAllowed("https://sweating-git-feature-team.vercel.app", locked), true);
  assert.equal(isOriginAllowed("https://another-preview.vercel.app", locked), false);

  const forced = resolveCorsPolicy({
    NODE_ENV: "production",
    VERCEL_ENV: "production",
    CORS_ALLOW_VERCEL_PREVIEWS: " TRUE ",
  });
  assert.equal(forced.allowVercelPreviews, true);
  assert.equal(isOriginAllowed("https://your-project.vercel.app", forced), true);
});

test("invalid allowlist values fail closed and do not echo embedded secrets", () => {
  const secret = "super-secret-token";
  assert.throws(
    () => resolveCorsPolicy({ CORS_ALLOWED_ORIGINS: `https://user:${secret}@evil.example` }),
    error => {
      assert.match(error.message, /username, password, path/);
      assert.equal(error.message.includes(secret), false);
      return true;
    },
  );
  assert.throws(() => resolveCorsPolicy({ CORS_ALLOWED_ORIGINS: "*" }), /cannot use wildcards/);
  assert.throws(() => resolveCorsPolicy({ CORS_ALLOWED_ORIGINS: "https://evil.example/phish" }), /path/);
  assert.throws(() => resolveCorsPolicy({ CORS_ALLOWED_ORIGINS: "null" }), /Invalid CORS origin/);
  assert.throws(
    () => resolveCorsPolicy({ CORS_ALLOW_VERCEL_PREVIEWS: secret }),
    error => {
      assert.match(error.message, /must be "true" or "false"/);
      assert.equal(error.message.includes(secret), false);
      return true;
    },
  );
  assert.throws(
    () => resolveCorsPolicy({ VERCEL_URL: `user:${secret}@evil.example` }),
    error => {
      assert.match(error.message, /VERCEL_URL must be an http/);
      assert.equal(error.message.includes(secret), false);
      return true;
    },
  );
});

test("middleware grants credentials only to an allowed origin", async () => {
  const app = express();
  app.use(createCorsMiddleware({
    NODE_ENV: "production",
    CORS_ALLOWED_ORIGINS: `${ALLOWED}, http://localhost:5173`,
    CORS_ALLOW_VERCEL_PREVIEWS: "false",
  }));
  app.get("/api/healthz", (_req, res) => {
    res.json({ status: "ok" });
  });
  const server = await listen(app);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const allowed = await fetch(`${base}/api/healthz`, { headers: { Origin: ALLOWED } });
    assert.equal(allowed.status, 200);
    assertCredentialed(allowed, ALLOWED);

    const local = await fetch(`${base}/api/healthz`, { headers: { Origin: "http://localhost:5173" } });
    assertCredentialed(local, "http://localhost:5173");

    const denied = await fetch(`${base}/api/healthz`, { headers: { Origin: DENIED } });
    assert.equal(denied.status, 200);
    assertNotCredentialed(denied, DENIED);

    const missing = await fetch(`${base}/api/healthz`);
    assert.equal(missing.status, 200);
    assert.equal(missing.headers.get("access-control-allow-credentials"), null);
    assert.equal(missing.headers.get("access-control-allow-origin"), null);

    const preflight = await fetch(`${base}/api/healthz`, {
      method: "OPTIONS",
      headers: {
        Origin: ALLOWED,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type",
      },
    });
    assert.equal(preflight.status, 204);
    assertCredentialed(preflight, ALLOWED);
    assert.match(preflight.headers.get("access-control-allow-methods") ?? "", /POST/);

    const deniedPreflight = await fetch(`${base}/api/healthz`, {
      method: "OPTIONS",
      headers: {
        Origin: DENIED,
        "Access-Control-Request-Method": "POST",
      },
    });
    assertNotCredentialed(deniedPreflight, DENIED);
  } finally {
    await close(server);
  }
});

test("built server allows a listed origin and refuses credentials for every other origin", async () => {
  const started = await startBuiltServer({
    CORS_ALLOWED_ORIGINS: ALLOWED,
    CORS_ALLOW_VERCEL_PREVIEWS: "false",
  });
  try {
    const base = `http://127.0.0.1:${started.port}/api/healthz`;
    const allowed = await fetch(base, { headers: { Origin: ALLOWED } });
    assert.equal(allowed.status, 200);
    assertCredentialed(allowed, ALLOWED);

    const denied = await fetch(base, { headers: { Origin: DENIED } });
    assert.equal(denied.status, 200);
    assertNotCredentialed(denied, DENIED);

    const preview = await fetch(base, { headers: { Origin: "https://random-preview.vercel.app" } });
    assertNotCredentialed(preview, "https://random-preview.vercel.app");

    const preflight = await fetch(base, {
      method: "OPTIONS",
      headers: { Origin: DENIED, "Access-Control-Request-Method": "GET" },
    });
    assertNotCredentialed(preflight, DENIED);
  } finally {
    await started.stop();
  }
});

test("built production server with no allowlist does not credential any origin", async () => {
  const started = await startBuiltServer();
  try {
    const response = await fetch(`http://127.0.0.1:${started.port}/api/healthz`, {
      headers: { Origin: "http://localhost:5173" },
    });
    assert.equal(response.status, 200);
    assertNotCredentialed(response, "http://localhost:5173");
  } finally {
    await started.stop();
  }
});

test("production origin is explicit and preview wildcards stay off", () => {
  const origin = "https://app.example.com";
  const policy = resolveCorsPolicy({
    NODE_ENV: "production",
    VERCEL_ENV: "production",
    CORS_ALLOWED_ORIGINS: origin,
    CORS_ALLOW_VERCEL_PREVIEWS: "false",
  });
  assert.equal(policy.allowVercelPreviews, false);
  assert.equal(isOriginAllowed(origin, policy), true);
  assert.equal(isOriginAllowed("https://other.vercel.app", policy), false);
});

test("built server serves no-origin requests and the production origin with preview wildcards off", async () => {
  const origin = "https://app.example.com";
  const started = await startBuiltServer({
    VERCEL_ENV: "production",
    CORS_ALLOWED_ORIGINS: origin,
    CORS_ALLOW_VERCEL_PREVIEWS: "false",
  });
  try {
    const base = `http://127.0.0.1:${started.port}/api/healthz`;
    const noOrigin = await fetch(base);
    assert.equal(noOrigin.status, 200);
    assert.equal(noOrigin.headers.get("access-control-allow-origin"), null);
    assert.equal(noOrigin.headers.get("access-control-allow-credentials"), null);

    const sameOrigin = await fetch(base, { headers: { Origin: origin } });
    assert.equal(sameOrigin.status, 200);
    assertCredentialed(sameOrigin, origin);

    const otherPreview = await fetch(base, { headers: { Origin: "https://other.vercel.app" } });
    assert.equal(otherPreview.status, 200);
    assertNotCredentialed(otherPreview, "https://other.vercel.app");
  } finally {
    await started.stop();
  }
});

test("built server refuses a wildcard allowlist before listening", () => {
  const env = serverEnv(0, { CORS_ALLOWED_ORIGINS: "*" });
  const result = spawnSync(process.execPath, [entry], { env, encoding: "utf8", timeout: 15000 });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr ?? "", /cannot use wildcards/);
  assert.equal((result.stdout ?? "").includes("Server listening"), false);
  assert.equal((result.stdout ?? "").includes(env.SESSION_SECRET), false);
  assert.equal((result.stderr ?? "").includes(env.SESSION_SECRET), false);
});
