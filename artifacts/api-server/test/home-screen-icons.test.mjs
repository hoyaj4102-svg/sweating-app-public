import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const publicDir = path.join(repoRoot, "artifacts/swetin-workout-dating/public");

function pngInfo(file) {
  const buf = readFileSync(path.join(publicDir, file));
  assert.equal(buf.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", `${file} is not a PNG`);
  assert.equal(buf.subarray(12, 16).toString("ascii"), "IHDR");
  assert.equal(buf.includes(Buffer.from("tRNS")), false, `${file} has a transparency chunk`);
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
    bitDepth: buf[24],
    colorType: buf[25],
  };
}

test("home screen icons are opaque PNGs at the sizes iOS and Android request", () => {
  const expected = {
    "apple-touch-icon.png": 180,
    "icon-192.png": 192,
    "icon-512.png": 512,
    "icon-512-maskable.png": 512,
    "favicon-32.png": 32,
  };
  for (const [file, size] of Object.entries(expected)) {
    const info = pngInfo(file);
    assert.equal(info.width, size, file);
    assert.equal(info.height, size, file);
    assert.equal(info.bitDepth, 8, file);
    assert.equal(info.colorType, 2, `${file} must be RGB without an alpha channel`);
  }

  const ico = readFileSync(path.join(publicDir, "favicon.ico"));
  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1);
  assert.equal(ico.readUInt16LE(4), 2, "favicon.ico should contain 16 and 32");

  const svg = readFileSync(path.join(publicDir, "favicon.svg"), "utf8");
  assert.match(svg, /fill="#FF3C00"/);
  assert.match(svg, /fill="#FFFFFF"/);
  assert.doesNotMatch(svg, /\brx=/);
});

test("index.html advertises the apple touch icon, title, theme color, and manifest", () => {
  const html = readFileSync(path.join(repoRoot, "artifacts/swetin-workout-dating/index.html"), "utf8");
  assert.match(html, /<link rel="apple-touch-icon" sizes="180x180" href="\/apple-touch-icon\.png" \/>/);
  assert.match(html, /<meta name="apple-mobile-web-app-title" content="SWEATING" \/>/);
  assert.match(html, /<meta name="theme-color" content="#FF3C00" \/>/);
  assert.match(html, /<link rel="manifest" href="\/manifest\.webmanifest" \/>/);

  const manifest = JSON.parse(readFileSync(path.join(publicDir, "manifest.webmanifest"), "utf8"));
  assert.equal(manifest.name, "SWEATING");
  assert.equal(manifest.short_name, "SWEATING");
  assert.equal(manifest.start_url, "/");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.theme_color, "#FF3C00");
  const icons = manifest.icons.map((icon) => `${icon.sizes} ${icon.purpose} ${icon.src}`);
  assert.deepEqual(icons, [
    "192x192 any /icon-192.png",
    "512x512 any /icon-512.png",
    "512x512 maskable /icon-512-maskable.png",
  ]);
});

test("the SPA rewrite does not swallow icon or manifest URLs and content types are explicit", () => {
  const config = JSON.parse(readFileSync(path.join(repoRoot, "vercel.json"), "utf8"));
  const spa = config.rewrites.find((rule) => rule.destination === "/index.html");
  const re = new RegExp(`^${spa.source}$`);
  for (const pathname of ["/", "/home", "/about", "/classes/abc", "/assets/index-abc.js"]) {
    assert.equal(re.test(pathname), true, pathname);
  }
  for (const pathname of [
    "/api",
    "/api/healthz",
    "/apple-touch-icon.png",
    "/manifest.webmanifest",
    "/favicon.ico",
    "/favicon.svg",
    "/favicon-32.png",
    "/icon-192.png",
    "/icon-512.png",
    "/icon-512-maskable.png",
  ]) {
    assert.equal(re.test(pathname), false, pathname);
  }

  const typeFor = (source) =>
    config.headers.find((rule) => rule.source === source)?.headers.find((header) => header.key === "Content-Type")?.value;
  assert.equal(typeFor("/manifest.webmanifest"), "application/manifest+json");
  assert.equal(typeFor("/apple-touch-icon.png"), "image/png");
  assert.equal(typeFor("/icon-192.png"), "image/png");
  assert.equal(typeFor("/icon-512.png"), "image/png");
  assert.equal(typeFor("/icon-512-maskable.png"), "image/png");
  assert.equal(typeFor("/favicon.ico"), "image/x-icon");
  assert.equal(typeFor("/favicon.svg"), "image/svg+xml");
});
