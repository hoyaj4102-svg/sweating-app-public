import type { ProfileRow } from "./data";
import { logger } from "./logger";
import {
  PHOTO_SAVE_ERROR,
  PHOTO_SIZE_ERROR,
  PHOTO_TYPE_ERROR,
  PROFILE_PHOTO_BUCKET,
  PROFILE_PHOTO_MAX_BYTES,
  PROFILE_PHOTO_SIGNED_URL_SECONDS,
  PhotoRequestError,
  detectImage,
  legacyPhotoUrl,
  ownedStorageObjectPath,
  profilePhotoObjectName,
  profilePhotoStoredValue,
  siblingObjectPaths,
  stripImageMetadata,
} from "./profile-photo";
import { getSupabaseServiceRoleKey, measureSupabaseFetch, supabaseJson } from "./supabase";

type UploadResult = {
  profile_photo_ref: string;
  profile_photo_url: string;
};

function supabaseUrl(): string {
  const url = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  if (!url) throw new Error("SUPABASE_URL is required for server-side Supabase operations.");
  return url;
}

function anonKey(): string {
  const key = process.env.SUPABASE_ANON_KEY;
  if (!key) throw new Error("SUPABASE_ANON_KEY is required for server-side Supabase operations.");
  return key;
}

function statusOf(error: unknown): number | undefined {
  if (!error || typeof error !== "object" || !("status" in error)) return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

async function storageResponse(
  path: string,
  init: RequestInit,
  accessToken: string,
  apiKey: string,
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("apikey", apiKey);
  headers.set("authorization", `Bearer ${accessToken}`);
  return measureSupabaseFetch(path, () => fetch(`${supabaseUrl()}${path}`, { ...init, headers }));
}

async function createSignedUrl(objectPath: string): Promise<string> {
  const serviceKey = getSupabaseServiceRoleKey();
  const encoded = objectPath.split("/").map((part) => encodeURIComponent(part)).join("/");
  const response = await storageResponse(
    `/storage/v1/object/sign/${PROFILE_PHOTO_BUCKET}/${encoded}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expiresIn: PROFILE_PHOTO_SIGNED_URL_SECONDS }),
    },
    serviceKey,
    serviceKey,
  );
  if (!response.ok) throw Object.assign(new Error(PHOTO_SAVE_ERROR), { status: response.status });
  const payload = await response.json() as { signedURL?: unknown; signedUrl?: unknown };
  const signed = typeof payload.signedURL === "string"
    ? payload.signedURL
    : typeof payload.signedUrl === "string"
      ? payload.signedUrl
      : "";
  if (!signed) throw new Error(PHOTO_SAVE_ERROR);
  if (/^https?:\/\//i.test(signed)) return signed;
  const base = supabaseUrl();
  if (signed.startsWith("/storage/v1/")) return `${base}${signed}`;
  if (signed.startsWith("/")) return `${base}/storage/v1${signed}`;
  return `${base}/storage/v1/${signed}`;
}

/**
 * Storage's object routes answer almost every failure with HTTP 400 and put the
 * real outcome in the body. A missing object is
 * `{ statusCode: "404", error: "not_found", code: "NoSuchKey" }`, not HTTP 404.
 */
function isMissingStorageObject(status: number, body: unknown): boolean {
  if (status === 404) return true;
  if (!body || typeof body !== "object") return false;
  const record = body as { statusCode?: unknown; error?: unknown; code?: unknown };
  if (record.statusCode === 404 || record.statusCode === "404") return true;
  const error = typeof record.error === "string" ? record.error.toLowerCase() : "";
  if (error === "not_found") return true;
  const code = typeof record.code === "string" ? record.code.toLowerCase() : "";
  return code === "nosuchkey" || code === "nosuchbucket";
}

async function deleteObject(objectPath: string, accessToken: string): Promise<void> {
  const encoded = objectPath.split("/").map((part) => encodeURIComponent(part)).join("/");
  const response = await storageResponse(
    `/storage/v1/object/${PROFILE_PHOTO_BUCKET}/${encoded}`,
    { method: "DELETE" },
    accessToken,
    anonKey(),
  );
  if (response.ok) return;
  const body = await response.json().catch(() => null);
  if (isMissingStorageObject(response.status, body)) return;
  throw Object.assign(new Error(PHOTO_SAVE_ERROR), { status: response.status });
}

/**
 * Signed URL for a storage object that belongs to subjectUserId.
 * Callers decide whether the viewer is the owner, a revealed peer, or an admin.
 * Legacy http(s) values are returned unchanged. A storage reference is never returned raw.
 */
export async function displayProfilePhoto(stored: string | null | undefined, subjectUserId: string): Promise<string> {
  if (!ownedStorageObjectPath(stored, subjectUserId)) return legacyPhotoUrl(stored);
  try {
    const path = ownedStorageObjectPath(stored, subjectUserId);
    if (!path) return "";
    return await createSignedUrl(path);
  } catch (error) {
    logger.error({ status: statusOf(error) }, "profile photo signing failed");
    return "";
  }
}

export async function withDisplayPhoto<T extends { id: string; profile_photo_url?: string | null }>(row: T): Promise<T & { profile_photo_url: string }> {
  return {
    ...row,
    profile_photo_url: await displayProfilePhoto(row.profile_photo_url, row.id),
  };
}

export async function deleteReplacedProfilePhoto(
  previous: string | null | undefined,
  next: string,
  userId: string,
  accessToken: string,
): Promise<void> {
  const previousPath = previous ? ownedStorageObjectPath(previous, userId) : null;
  const nextPath = ownedStorageObjectPath(next, userId);
  if (!previousPath || previousPath === nextPath) return;
  await deleteObject(previousPath, accessToken);
}

export async function storeProfilePhoto(input: {
  userId: string;
  accessToken: string;
  bytes: Uint8Array;
  contentType: string | null;
  previous: string | null;
  hasProfile: boolean;
}): Promise<UploadResult> {
  if (input.bytes.byteLength > PROFILE_PHOTO_MAX_BYTES) {
    throw new PhotoRequestError(PHOTO_SIZE_ERROR, 413);
  }
  const detected = detectImage(input.bytes, input.contentType);
  if (!detected) throw new PhotoRequestError(PHOTO_TYPE_ERROR);
  const stripped = stripImageMetadata(input.bytes, detected.mime);
  if (stripped.byteLength > PROFILE_PHOTO_MAX_BYTES) throw new PhotoRequestError(PHOTO_SIZE_ERROR, 413);

  const objectPath = profilePhotoObjectName(input.userId, detected.extension);
  const stored = profilePhotoStoredValue(objectPath);
  const encoded = objectPath.split("/").map((part) => encodeURIComponent(part)).join("/");
  const uploaded = await storageResponse(
    `/storage/v1/object/${PROFILE_PHOTO_BUCKET}/${encoded}`,
    {
      method: "POST",
      headers: {
        "content-type": detected.mime,
        "cache-control": "private, max-age=0",
        "x-upsert": "true",
      },
      body: stripped,
    },
    input.accessToken,
    anonKey(),
  );
  if (!uploaded.ok) {
    logger.error({ status: uploaded.status }, "profile photo upload rejected");
    throw new PhotoRequestError(PHOTO_SAVE_ERROR);
  }

  if (input.hasProfile) {
    await supabaseJson<ProfileRow[]>(
      `/rest/v1/profiles?id=eq.${encodeURIComponent(input.userId)}`,
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ profile_photo_url: stored }),
      },
      input.accessToken,
    );
  }

  const removals = siblingObjectPaths(input.userId, objectPath);
  const previousPath = input.previous ? ownedStorageObjectPath(input.previous, input.userId) : null;
  if (previousPath && previousPath !== objectPath && !removals.includes(previousPath)) removals.push(previousPath);
  for (const path of removals) {
    try {
      await deleteObject(path, input.accessToken);
    } catch (error) {
      // The new object is already stored. A stale-file cleanup failure must not
      // fail the upload or surface a photo error to the member.
      logger.error({ status: statusOf(error) }, "profile photo cleanup failed");
    }
  }

  return {
    profile_photo_ref: stored,
    profile_photo_url: await displayProfilePhoto(stored, input.userId),
  };
}
