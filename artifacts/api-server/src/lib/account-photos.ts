import { PROFILE_PHOTO_BUCKET, ownedStorageObjectPath } from "./profile-photo";
import { logger } from "./logger";
import { getSupabaseServiceRoleKey, measureSupabaseFetch } from "./supabase";

const AVATAR_EXTENSIONS = ["jpg", "jpeg", "png", "webp"] as const;

export class ProfilePhotoDeletionError extends Error {
  readonly status: number;

  constructor(status = 0) {
    super("profile photo deletion failed");
    this.name = "ProfilePhotoDeletionError";
    this.status = status;
  }
}

function ownerPrefix(userId: string): string {
  const owner = userId.trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(owner)) {
    throw new ProfilePhotoDeletionError(400);
  }
  return `${owner}/`;
}

function ownedPath(prefix: string, raw: string): string | null {
  const trimmed = raw.trim().replace(/^\/+/, "");
  if (!trimmed || trimmed.includes("..") || trimmed.includes("\\")) return null;
  if (trimmed.includes("/")) {
    if (!trimmed.toLowerCase().startsWith(prefix)) return null;
    return `${prefix}${trimmed.slice(prefix.length)}`;
  }
  return `${prefix}${trimmed}`;
}

/** Current avatar, earlier extensions, and every listed object under this member. */
export function profilePhotoDeletionPaths(
  userId: string,
  stored: string | null | undefined,
  listed: readonly string[],
): string[] {
  const prefix = ownerPrefix(userId);
  const paths = new Set<string>();
  for (const extension of AVATAR_EXTENSIONS) paths.add(`${prefix}avatar.${extension}`);
  const current = ownedStorageObjectPath(stored, userId);
  if (current) paths.add(current);
  for (const name of listed) {
    const path = ownedPath(prefix, name);
    if (path) paths.add(path);
  }
  return [...paths];
}

function supabaseUrl(): string {
  const url = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  if (!url) throw new ProfilePhotoDeletionError(0);
  return url;
}

async function storageRequest(path: string, init: RequestInit): Promise<Response> {
  const key = getSupabaseServiceRoleKey();
  const headers = new Headers(init.headers);
  headers.set("apikey", key);
  headers.set("authorization", `Bearer ${key}`);
  return measureSupabaseFetch(path, () => fetch(`${supabaseUrl()}${path}`, { ...init, headers }));
}

function alreadyGone(status: number, body: string): boolean {
  if (status === 404) return true;
  return /not found|does not exist|Object not found/i.test(body);
}

async function listOwnedObjects(prefix: string): Promise<string[]> {
  const found: string[] = [];
  for (let offset = 0; offset < 1000; offset += 100) {
    const response = await storageRequest(`/storage/v1/object/list/${PROFILE_PHOTO_BUCKET}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prefix,
        limit: 100,
        offset,
        sortBy: { column: "name", order: "asc" },
      }),
    });
    const body = await response.text();
    if (!response.ok) {
      if (alreadyGone(response.status, body)) return found;
      throw new ProfilePhotoDeletionError(response.status);
    }
    let rows: unknown;
    try {
      rows = body ? JSON.parse(body) : [];
    } catch {
      throw new ProfilePhotoDeletionError(response.status);
    }
    if (!Array.isArray(rows)) throw new ProfilePhotoDeletionError(response.status);
    for (const row of rows) {
      if (!row || typeof row !== "object" || !("name" in row)) continue;
      const name = (row as { name?: unknown }).name;
      if (typeof name === "string") found.push(name);
    }
    if (rows.length < 100) break;
  }
  return found;
}

/**
 * Removes every profile-photos object for this member through the Storage API.
 * A missing object is success, so a retry after a partial delete is safe.
 * Throws when the API rejects the call. Does not delete the auth user.
 */
export async function deleteOwnedProfilePhotos(userId: string, stored: string | null | undefined): Promise<void> {
  const prefix = ownerPrefix(userId);
  let listed: string[] = [];
  try {
    listed = await listOwnedObjects(prefix);
  } catch (error) {
    const status = error instanceof ProfilePhotoDeletionError ? error.status : 0;
    logger.error({ status, count: 0 }, "Profile photo list failed; account was kept");
    throw error instanceof ProfilePhotoDeletionError ? error : new ProfilePhotoDeletionError(status);
  }
  const paths = profilePhotoDeletionPaths(userId, stored, listed);
  const response = await storageRequest(`/storage/v1/object/${PROFILE_PHOTO_BUCKET}`, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(paths),
  });
  const body = await response.text();
  if (response.ok || alreadyGone(response.status, body)) {
    logger.info({ status: response.status, count: paths.length }, "Profile photos removed");
    return;
  }
  logger.error({ status: response.status, count: paths.length }, "Profile photo deletion failed; account was kept");
  throw new ProfilePhotoDeletionError(response.status);
}
