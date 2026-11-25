import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import http from "node:http";
import { register } from "node:module";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

register(new URL("./resolve-ts.mjs", import.meta.url), import.meta.url);
import {
  PHOTO_OWNER_ERROR,
  PHOTO_TYPE_ERROR,
  canonicalProfilePhotoValue,
  detectImage,
  siblingObjectPaths,
  stripImageMetadata,
} from "../src/lib/profile-photo.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const userId = "a5a5a5a5-a5a5-45a5-85a5-a5a5a5a5a5a5";
const otherId = "d5d5d5d5-d5d5-45d5-85d5-d5d5d5d5d5d5";
const accessToken = "user-access-token";
const serviceKey = "test-service";

function textOf(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function jpegWithGps(): Uint8Array {
  const payload = new TextEncoder().encode("Exif\0\0GPSLatitude");
  const length = 2 + payload.length;
  return Uint8Array.from([
    0xff, 0xd8,
    0xff, 0xe1, (length >> 8) & 0xff, length & 0xff,
    ...payload,
    0xff, 0xda, 0x00, 0x02,
    0x12,
    0xff, 0xd9,
  ]);
}

function pngWithText(): Uint8Array {
  const signature = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const text = new TextEncoder().encode("Comment\0GPSLatitude");
  const chunk = new Uint8Array(12 + text.length);
  chunk[0] = (text.length >>> 24) & 0xff;
  chunk[1] = (text.length >>> 16) & 0xff;
  chunk[2] = (text.length >>> 8) & 0xff;
  chunk[3] = text.length & 0xff;
  chunk.set(new TextEncoder().encode("tEXt"), 4);
  chunk.set(text, 8);
  const iend = Uint8Array.from([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0, 0, 0, 0]);
  const out = new Uint8Array(signature.length + chunk.length + iend.length);
  out.set(signature, 0);
  out.set(chunk, signature.length);
  out.set(iend, signature.length + chunk.length);
  return out;
}

function webpWithExif(): Uint8Array {
  const exif = new TextEncoder().encode("GPSLatitude");
  const chunk = new Uint8Array(8 + exif.length + (exif.length % 2));
  chunk.set(new TextEncoder().encode("EXIF"), 0);
  chunk[4] = exif.length & 0xff;
  chunk[5] = (exif.length >>> 8) & 0xff;
  chunk.set(exif, 8);
  const file = new Uint8Array(12 + chunk.length);
  file.set(new TextEncoder().encode("RIFF"), 0);
  const size = 4 + chunk.length;
  file[4] = size & 0xff;
  file[5] = (size >>> 8) & 0xff;
  file.set(new TextEncoder().encode("WEBP"), 8);
  file.set(chunk, 12);
  return file;
}

test("metadata strip removes GPS markers and keeps the image container", () => {
  const jpeg = stripImageMetadata(jpegWithGps(), "image/jpeg");
  assert.equal(textOf(jpeg).includes("GPSLatitude"), false);
  assert.equal(jpeg[0], 0xff);
  assert.equal(jpeg[1], 0xd8);
  assert.equal(jpeg.at(-2), 0xff);
  assert.equal(jpeg.at(-1), 0xd9);

  const png = stripImageMetadata(pngWithText(), "image/png");
  assert.equal(textOf(png).includes("GPSLatitude"), false);
  assert.equal(textOf(png).includes("IEND"), true);

  const webp = stripImageMetadata(webpWithExif(), "image/webp");
  assert.equal(textOf(webp).includes("GPSLatitude"), false);
  assert.equal(textOf(webp).slice(0, 4), "RIFF");
  assert.equal(textOf(webp).slice(8, 12), "WEBP");
});

test("image detection requires the content type and the magic bytes to match", () => {
  assert.equal(detectImage(jpegWithGps(), "image/jpeg")?.extension, "jpg");
  assert.equal(detectImage(jpegWithGps(), "image/png"), null);
  assert.equal(detectImage(pngWithText(), "image/png")?.extension, "png");
  assert.equal(detectImage(webpWithExif(), "image/webp")?.extension, "webp");
  assert.equal(detectImage(Uint8Array.of(0x47, 0x49, 0x46), "image/gif"), null);
});

test("profile photo values keep legacy URLs and reject another member's object", () => {
  const legacy = canonicalProfilePhotoValue("https://example.test/photo.png", userId);
  assert.deepEqual(legacy, { ok: true, value: "https://example.test/photo.png" });

  const own = canonicalProfilePhotoValue(`profile-photos/${userId}/avatar.jpeg`, userId);
  assert.deepEqual(own, { ok: true, value: `profile-photos/${userId}/avatar.jpeg` });

  const signed = canonicalProfilePhotoValue(
    `https://example.test/storage/v1/object/sign/profile-photos/${userId}/avatar.png?token=short-lived`,
    userId,
  );
  assert.deepEqual(signed, { ok: true, value: `profile-photos/${userId}/avatar.png` });
  if (signed.ok) assert.equal(signed.value.includes("token"), false);

  const foreign = canonicalProfilePhotoValue(`profile-photos/${otherId}/avatar.jpg`, userId);
  assert.deepEqual(foreign, { ok: false, error: PHOTO_OWNER_ERROR });

  const foreignSigned = canonicalProfilePhotoValue(
    `https://example.test/storage/v1/object/sign/profile-photos/${otherId}/avatar.jpg?token=short-lived`,
    userId,
  );
  assert.deepEqual(foreignSigned, { ok: false, error: PHOTO_OWNER_ERROR });
  assert.deepEqual(siblingObjectPaths(userId, `${userId}/avatar.jpg`).includes(`${userId}/avatar.png`), true);
  assert.deepEqual(siblingObjectPaths(userId, `${userId}/avatar.jpg`).includes(`${userId}/avatar.jpg`), false);
});

test("the profile photo migration does not rewrite profile rows", async () => {
  const sql = await readFile(
    path.join(repoRoot, "artifacts/api-server/supabase/migrations/20261112_profile_photo_storage.sql"),
    "utf8",
  );
  assert.doesNotMatch(sql, /update\s+(public\.)?profiles/i);
  assert.doesNotMatch(sql, /delete\s+from\s+(public\.)?profiles/i);
  assert.doesNotMatch(sql, /insert\s+into\s+(public\.)?profiles/i);
});

function signedSession() {
  const value = JSON.stringify({
    accessToken,
    user: { id: userId, email: "user@example.test" },
  });
  const signature = createHmac("sha256", "test-only-session-secret")
    .update(value)
    .digest("base64")
    .replace(/=+$/, "");
  return `swetin_session=${encodeURIComponent(`s:${value}.${signature}`)}`;
}

test("upload stores a private object for the owner and deletes the previous one", async () => {
  process.env.NODE_ENV = "test";
  process.env.SESSION_SECRET = "test-only-session-secret";
  process.env.SUPABASE_URL = "https://example.test";
  process.env.SUPABASE_ANON_KEY = "test-anon";
  process.env.SUPABASE_SERVICE_ROLE_KEY = serviceKey;
  process.env.LOG_LEVEL = "silent";

  const calls: Array<{ method: string; pathname: string; authorization: string; body: Uint8Array | string | null }> = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    if (String(input).startsWith("http://127.0.0.1")) return previousFetch(input, init);
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    const method = init?.method ?? "GET";
    const body = init?.body instanceof Uint8Array
      ? init.body
      : typeof init?.body === "string"
        ? init.body
        : null;
    calls.push({
      method,
      pathname: url.pathname,
      authorization: headers.get("authorization") ?? "",
      body,
    });
    if (url.pathname === "/auth/v1/user") {
      return Response.json({ id: userId, email: "user@example.test" });
    }
    if (url.pathname === "/rest/v1/profiles" && method === "GET") {
      return Response.json([{
        id: userId,
        display_name: "Member",
        birth_year: 1996,
        age_preference: "both",
        gender: null,
        profile_photo_url: `profile-photos/${userId}/avatar.png`,
        sports: ["러닝"],
        interests: [],
        bio: null,
        is_admin: false,
        created_at: "2026-10-01T00:00:00.000Z",
        updated_at: "2026-10-01T00:00:00.000Z",
      }]);
    }
    if (url.pathname === "/rest/v1/profiles" && method === "PATCH") {
      const parsed = JSON.parse(String(init?.body));
      return Response.json([{
        id: userId,
        display_name: "Member",
        birth_year: 1996,
        age_preference: "both",
        profile_photo_url: parsed.profile_photo_url,
        sports: ["러닝"],
        interests: [],
        bio: null,
        is_admin: false,
        created_at: "2026-10-01T00:00:00.000Z",
        updated_at: "2026-10-01T00:00:00.000Z",
      }]);
    }
    if (url.pathname.startsWith("/storage/v1/object/sign/")) {
      assert.equal(headers.get("authorization"), `Bearer ${serviceKey}`);
      return Response.json({ signedURL: `/object/sign${url.pathname.slice("/storage/v1/object/sign".length)}?token=short` });
    }
    if (url.pathname.startsWith("/storage/v1/object/profile-photos/") && method === "POST") {
      assert.equal(headers.get("authorization"), `Bearer ${accessToken}`);
      assert.equal(headers.get("x-upsert"), "true");
      return Response.json({ Key: "stored" });
    }
    if (method === "DELETE") return new Response(null, { status: 200 });
    return Response.json({ message: "unexpected" }, { status: 500 });
  };

  const { default: app } = await import("../src/app.ts");
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  try {
    const jpeg = jpegWithGps();
    const response = await fetch(`http://127.0.0.1:${address.port}/api/profiles/me/photo`, {
      method: "POST",
      headers: {
        cookie: signedSession(),
        "content-type": "image/jpeg",
      },
      body: jpeg,
    });
    assert.equal(response.status, 200);
    const payload = await response.json() as { profile_photo_ref: string; profile_photo_url: string };
    assert.equal(payload.profile_photo_ref, `profile-photos/${userId}/avatar.jpg`);
    assert.match(payload.profile_photo_url, /^https:\/\/example\.test\/storage\/v1\/object\/sign\//);
    assert.match(payload.profile_photo_url, /token=short/);
    assert.equal(payload.profile_photo_url.includes(userId) , true);

    const upload = calls.find((call) => call.method === "POST" && call.pathname.includes("/avatar.jpg"));
    assert.ok(upload);
    assert.equal(upload.authorization, `Bearer ${accessToken}`);
    assert.equal(textOf(upload.body as Uint8Array).includes("GPSLatitude"), false);
    const patch = calls.find((call) => call.method === "PATCH");
    assert.match(String(patch?.body), new RegExp(`profile-photos/${userId}/avatar.jpg`));
    assert.equal(
      calls.some((call) => call.method === "DELETE" && call.pathname.endsWith("/avatar.png")),
      true,
    );
    const sign = calls.find((call) => call.pathname.includes("/object/sign/"));
    assert.equal(sign?.authorization, `Bearer ${serviceKey}`);
    assert.equal(
      calls.some((call) => call.pathname === `/storage/v1/object/profile-photos/${userId}/avatar.jpg` && call.authorization !== `Bearer ${accessToken}`),
      false,
    );

    const rejected = await fetch(`http://127.0.0.1:${address.port}/api/profiles/me/photo`, {
      method: "POST",
      headers: { cookie: signedSession(), "content-type": "image/gif" },
      body: Uint8Array.of(0x47, 0x49, 0x46, 0x38),
    });
    assert.equal(rejected.status, 400);
    assert.deepEqual(await rejected.json(), { error: PHOTO_TYPE_ERROR });
  } finally {
    globalThis.fetch = previousFetch;
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

const MISSING_OBJECT = {
  statusCode: "404",
  error: "not_found",
  message: "Object not found",
  code: "NoSuchKey",
};

type PhotoCall = {
  method: string;
  pathname: string;
  authorization: string;
  body: Uint8Array | string | null;
};

type StoredProfile = {
  id: string;
  display_name: string;
  birth_year: number;
  gender: null;
  profile_photo_url: string;
  sports: string[];
  interests: string[];
  bio: null;
  is_admin: boolean;
  created_at: string;
  updated_at: string;
};

function storedProfile(photo: string): StoredProfile {
  return {
    id: userId,
    display_name: "Member",
    birth_year: 1996,
    gender: null,
    profile_photo_url: photo,
    sports: ["러닝"],
    interests: ["커피"],
    bio: null,
    is_admin: false,
    created_at: "2026-11-14T00:00:00.000Z",
    updated_at: "2026-11-14T00:00:00.000Z",
  };
}

function missingObjectResponse(): Response {
  return Response.json(MISSING_OBJECT, { status: 400 });
}

async function withCleanupLogs(run: (statuses: number[]) => Promise<void>): Promise<void> {
  const { logger } = await import("../src/lib/logger.ts");
  const statuses: number[] = [];
  const original = logger.error;
  logger.error = ((first: unknown, second?: unknown) => {
    if (second === "profile photo cleanup failed" && first && typeof first === "object" && "status" in first) {
      const status = (first as { status?: unknown }).status;
      if (typeof status === "number") statuses.push(status);
    }
    return original.call(logger, first as never, second as never);
  }) as typeof logger.error;
  try {
    await run(statuses);
  } finally {
    logger.error = original;
  }
}

async function withPhotoApi(
  state: { profile: StoredProfile | null; onDelete: (pathname: string) => Response },
  run: (base: string, calls: PhotoCall[]) => Promise<void>,
): Promise<void> {
  process.env.NODE_ENV = "test";
  process.env.SESSION_SECRET = "test-only-session-secret";
  process.env.SUPABASE_URL = "https://example.test";
  process.env.SUPABASE_ANON_KEY = "test-anon";
  process.env.SUPABASE_SERVICE_ROLE_KEY = serviceKey;
  process.env.LOG_LEVEL = "silent";

  const calls: PhotoCall[] = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    if (String(input).startsWith("http://127.0.0.1")) return previousFetch(input, init);
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    const method = init?.method ?? "GET";
    const body = init?.body instanceof Uint8Array
      ? init.body
      : typeof init?.body === "string"
        ? init.body
        : null;
    calls.push({ method, pathname: url.pathname, authorization: headers.get("authorization") ?? "", body });
    if (url.pathname === "/auth/v1/user") {
      return Response.json({ id: userId, email: "user@example.test" });
    }
    if (url.pathname === "/rest/v1/rpc/current_consents_complete" && method === "POST") {
      return Response.json(true);
    }
    if (url.pathname === "/rest/v1/profiles" && method === "GET") {
      return Response.json(state.profile ? [state.profile] : []);
    }
    if (url.pathname === "/rest/v1/profiles" && method === "POST") {
      const parsed = JSON.parse(String(body)) as StoredProfile;
      state.profile = storedProfile(parsed.profile_photo_url);
      state.profile.display_name = parsed.display_name;
      state.profile.birth_year = parsed.birth_year;
      state.profile.sports = parsed.sports;
      state.profile.interests = parsed.interests;
      return Response.json([state.profile]);
    }
    if (url.pathname === "/rest/v1/profiles" && method === "PATCH") {
      const parsed = JSON.parse(String(body)) as { profile_photo_url?: string };
      if (!state.profile) return Response.json({ message: "missing profile" }, { status: 404 });
      if (parsed.profile_photo_url) state.profile = { ...state.profile, profile_photo_url: parsed.profile_photo_url };
      return Response.json([state.profile]);
    }
    if (url.pathname.startsWith("/storage/v1/object/sign/")) {
      return Response.json({ signedURL: `/object/sign${url.pathname.slice("/storage/v1/object/sign".length)}?token=short` });
    }
    if (url.pathname.startsWith("/storage/v1/object/profile-photos/") && method === "POST") {
      return Response.json({ Key: "stored" });
    }
    if (method === "DELETE" && url.pathname.startsWith("/storage/v1/object/profile-photos/")) {
      return state.onDelete(url.pathname);
    }
    return Response.json({ message: "unexpected" }, { status: 500 });
  };

  const { default: app } = await import("../src/app.ts");
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  try {
    await run(`http://127.0.0.1:${address.port}`, calls);
  } finally {
    globalThis.fetch = previousFetch;
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

function deletePaths(calls: PhotoCall[]): string[] {
  return calls
    .filter((call) => call.method === "DELETE")
    .map((call) => call.pathname);
}

test("a member with no profile row can upload a first photo and then save the profile", async () => {
  process.env.NODE_ENV = "test";
  process.env.LOG_LEVEL = "silent";
  const state = {
    profile: null as StoredProfile | null,
    onDelete: (_pathname: string) => missingObjectResponse(),
  };
  await withCleanupLogs(async (cleanupStatuses) => {
    await withPhotoApi(state, async (base, calls) => {
      const uploaded = await fetch(`${base}/api/profiles/me/photo`, {
        method: "POST",
        headers: { cookie: signedSession(), "content-type": "image/jpeg" },
        body: jpegWithGps(),
      });
      assert.equal(uploaded.status, 200);
      const payload = await uploaded.json() as { profile_photo_ref: string; profile_photo_url: string };
      assert.equal(payload.profile_photo_ref, `profile-photos/${userId}/avatar.jpg`);
      assert.match(payload.profile_photo_url, /token=short/);
      assert.deepEqual(deletePaths(calls), [
        `/storage/v1/object/profile-photos/${userId}/avatar.jpeg`,
        `/storage/v1/object/profile-photos/${userId}/avatar.png`,
        `/storage/v1/object/profile-photos/${userId}/avatar.webp`,
      ]);
      assert.equal(calls.some((call) => call.method === "PATCH"), false);
      assert.equal(cleanupStatuses.length, 0);

      calls.length = 0;
      const saved = await fetch(`${base}/api/profiles/me`, {
        method: "PUT",
        headers: { cookie: signedSession(), "content-type": "application/json" },
        body: JSON.stringify({
          display_name: "Member",
          birth_year: 1996,
          profile_photo_url: payload.profile_photo_ref,
          sports: ["러닝"],
          interests: ["커피"],
          bio: null,
        }),
      });
      assert.equal(saved.status, 200);
      const profile = await saved.json() as { display_name: string; profile_photo_url: string };
      assert.equal(profile.display_name, "Member");
      assert.match(profile.profile_photo_url, /token=short/);
      const insert = calls.find((call) => call.method === "POST" && call.pathname === "/rest/v1/profiles");
      assert.ok(insert);
      const written = JSON.parse(String(insert.body)) as { id: string; profile_photo_url: string };
      assert.equal(written.id, userId);
      assert.equal(written.profile_photo_url, payload.profile_photo_ref);
      assert.equal(calls.some((call) => call.method === "PATCH"), false);
    });
  });
});

test("a photo change succeeds when a missing object delete returns 400 not_found", async () => {
  process.env.NODE_ENV = "test";
  process.env.LOG_LEVEL = "silent";
  const state = {
    profile: storedProfile(`profile-photos/${userId}/avatar.png`),
    onDelete: (pathname: string) => pathname.endsWith("/avatar.png")
      ? Response.json({ statusCode: "403", error: "Unauthorized", code: "AccessDenied" }, { status: 400 })
      : missingObjectResponse(),
  };
  await withCleanupLogs(async (cleanupStatuses) => {
    await withPhotoApi(state, async (base, calls) => {
      const changed = await fetch(`${base}/api/profiles/me/photo`, {
        method: "POST",
        headers: { cookie: signedSession(), "content-type": "image/jpeg" },
        body: jpegWithGps(),
      });
      assert.equal(changed.status, 200);
      const payload = await changed.json() as { profile_photo_ref: string };
      assert.equal(payload.profile_photo_ref, `profile-photos/${userId}/avatar.jpg`);
      assert.deepEqual(deletePaths(calls), [
        `/storage/v1/object/profile-photos/${userId}/avatar.jpeg`,
        `/storage/v1/object/profile-photos/${userId}/avatar.png`,
        `/storage/v1/object/profile-photos/${userId}/avatar.webp`,
      ]);
      const patch = calls.find((call) => call.method === "PATCH");
      assert.match(String(patch?.body), new RegExp(`profile-photos/${userId}/avatar.jpg`));
      assert.deepEqual(cleanupStatuses, [400]);
    });
  });
});
