import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

test("vercel.json sends every nested /api path to the index function", () => {
  const config = JSON.parse(readFileSync(path.join(repoRoot, "vercel.json"), "utf8"));
  const rewrites = config.rewrites;
  assert.ok(Array.isArray(rewrites));

  const apiRewrite = rewrites.find((rule) => rule.destination === "/api");
  assert.equal(apiRewrite?.source, "/api/:path*");
  assert.deepEqual(apiRewrite?.transforms, [
    { type: "request.path", op: "set", args: "/api/:path*" },
  ]);

  const spa = rewrites.find((rule) => rule.destination === "/index.html");
  assert.equal(
    spa?.source,
    "/((?!api(?:/|$)|apple-touch-icon\\.png$|manifest\\.webmanifest$|favicon(?:-32)?\\.(?:ico|svg|png)$|icon-(?:512-maskable|512|192)\\.png$).*)",
  );
  assert.ok(rewrites.indexOf(apiRewrite) < rewrites.indexOf(spa));

  assert.equal(existsSync(path.join(repoRoot, "api/[...path].mjs")), false);
  const entry = readFileSync(path.join(repoRoot, "api/index.mjs"), "utf8");
  assert.match(entry, /vercel-handler\.mjs/);
  assert.equal(config.functions?.["api/**/*.mjs"]?.includeFiles, "artifacts/api-server/dist/*.mjs");
  assert.deepEqual(config.regions, ["hnd1"]);
  assert.equal(config.functionFailoverRegions, undefined);
  assert.equal(config.functions?.["api/**/*.mjs"]?.regions, undefined);
});
