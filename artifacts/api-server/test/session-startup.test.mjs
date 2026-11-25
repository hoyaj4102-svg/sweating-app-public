import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const entry = fileURLToPath(new URL("../dist/index.mjs", import.meta.url));

async function freePort() {
  const socket = createServer();
  await new Promise((resolve, reject) => {
    socket.once("error", reject);
    socket.listen(0, "127.0.0.1", resolve);
  });
  const port = socket.address().port;
  await new Promise((resolve, reject) => socket.close(err => err ? reject(err) : resolve()));
  return port;
}

test("built production server refuses missing and blank SESSION_SECRET before listening", async () => {
  for (const value of [undefined, "", " \t "]) {
    const env = { ...process.env, NODE_ENV: "production", PORT: String(await freePort()) };
    delete env.SESSION_SECRET;
    if (value !== undefined) env.SESSION_SECRET = value;
    const result = spawnSync(process.execPath, [entry], { env, encoding: "utf8", timeout: 15000 });
    assert.ok(result.status !== 0, "Expected startup refusal");
    assert.ok(result.stderr?.includes("SESSION_SECRET must be configured"), "Expected safe configuration error");
    assert.ok(!result.stdout?.includes("Server listening"), "Server must not open a listener");
  }
});

test("built production server starts with a generated test key and keeps anonymous auth protected", async () => {
  const port = await freePort();
  // Disposable test-process key only: never print, save or modify managed secrets.
  const env = { ...process.env, NODE_ENV: "production", PORT: String(port), SESSION_SECRET: randomBytes(48).toString("base64url") };
  const child = spawn(process.execPath, [entry], { env, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  let errors = "";
  child.stdout.on("data", b => { output += b.toString(); });
  child.stderr.on("data", b => { errors += b.toString(); });
  try {
    const deadline = Date.now() + 15000;
    while (!output.includes("Server listening") && child.exitCode === null && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.ok(output.includes("Server listening"), "Expected production startup with configured key");
    assert.ok(!output.includes(env.SESSION_SECRET) && !errors.includes(env.SESSION_SECRET), "Signing key must not be logged");
    const response = await fetch(`http://127.0.0.1:${port}/api/auth/me`);
    assert.equal(response.status, 401);
  } finally {
    if (child.exitCode === null) {
      await new Promise(resolve => { child.once("exit", resolve); child.kill("SIGTERM"); });
    }
  }
});
