import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import express from "express";
import cookieParser from "cookie-parser";
import { resolveSessionSecret } from "../src/lib/session-secret.ts";

test("configured secrets retain their exact bytes in every environment", () => {
  const configured = ` ${randomBytes(48).toString("base64url")} `;
  for (const NODE_ENV of ["production", "development", "test", undefined]) {
    assert.ok(resolveSessionSecret({ NODE_ENV, SESSION_SECRET: configured }) === configured);
  }
});

test("missing, empty or whitespace secrets fail closed outside development", () => {
  for (const NODE_ENV of ["production", "test", "staging", undefined]) {
    for (const SESSION_SECRET of [undefined, "", " \t\r\n "]) {
      assert.throws(() => resolveSessionSecret({ NODE_ENV, SESSION_SECRET }), /SESSION_SECRET must be configured/);
    }
  }
});

test("development generates one process-local random key without modifying the environment", () => {
  const environment = Object.freeze({ NODE_ENV: "development" });
  const a = resolveSessionSecret(environment);
  const b = resolveSessionSecret(environment);
  assert.ok(a === b);
  assert.equal(Buffer.from(a, "base64url").length, 48);
  assert.ok(!("SESSION_SECRET" in environment));
  assert.ok(resolveSessionSecret({ NODE_ENV: "development", SESSION_SECRET: "" }) === a);
});

test("signed login-style cookies survive unchanged configured keys and reject tampering or foreign keys", async () => {
  const configured = randomBytes(48).toString("base64url");
  const foreign = randomBytes(48).toString("base64url");
  const token = randomBytes(32).toString("base64url");
  const app = express();
  app.use("/foreign", cookieParser(resolveSessionSecret({ NODE_ENV: "production", SESSION_SECRET: foreign })));
  app.use(cookieParser(resolveSessionSecret({ NODE_ENV: "production", SESSION_SECRET: configured })));
  app.get("/issue", (_req, res) => {
    res.cookie("test_session", token, { signed: true, httpOnly: true, sameSite: "lax" });
    res.sendStatus(204);
  });
  app.get(["/verify", "/foreign"], (req, res) => {
    res.sendStatus(req.signedCookies?.test_session === token ? 204 : 401);
  });
  app.get("/logout", (_req, res) => {
    res.clearCookie("test_session", { httpOnly: true, sameSite: "lax" });
    res.sendStatus(204);
  });
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    const issued = await fetch(`${base}/issue`);
    assert.equal(issued.status, 204);
    const cookie = issued.headers.get("set-cookie");
    assert.ok(cookie.includes("HttpOnly"));
    const pair = cookie.split(";")[0];
    assert.equal((await fetch(`${base}/verify`, { headers: { cookie: pair } })).status, 204);
    assert.equal((await fetch(`${base}/foreign`, { headers: { cookie: pair } })).status, 401);
    assert.equal((await fetch(`${base}/verify`, { headers: { cookie: `${pair}x` } })).status, 401);
    assert.equal((await fetch(`${base}/verify`)).status, 401);
    const logout = await fetch(`${base}/logout`);
    assert.equal(logout.status, 204);
    assert.ok(logout.headers.get("set-cookie")?.includes("Expires=Thu, 01 Jan 1970"));
  } finally {
    await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  }
});
