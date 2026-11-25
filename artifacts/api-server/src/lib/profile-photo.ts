export const PROFILE_PHOTO_BUCKET = "profile-photos";
export const PROFILE_PHOTO_MAX_BYTES = 5 * 1024 * 1024;
export const PROFILE_PHOTO_SIGNED_URL_SECONDS = 300;

export const PHOTO_TYPE_ERROR = "지원하는 사진 형식만 올릴 수 있습니다.";
export const PHOTO_SIZE_ERROR = "사진 용량이 너무 큽니다.";
export const PHOTO_REQUIRED_ERROR = "프로필 사진을 올려 주세요.";
export const PHOTO_OWNER_ERROR = "다른 사람의 사진은 저장할 수 없습니다.";
export const PHOTO_SAVE_ERROR = "사진을 저장하지 못했습니다.";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const STORAGE_KEY = new RegExp(`^profile-photos/(${UUID})/avatar\\.(jpe?g|png|webp)$`, "i");
const STORAGE_URL_PATH = new RegExp(
  `/storage/v1/object/(?:sign|public|authenticated)/profile-photos/(${UUID})/avatar\\.(jpe?g|png|webp)$`,
  "i",
);

export type PhotoMime = "image/jpeg" | "image/png" | "image/webp";
export type PhotoExtension = "jpg" | "png" | "webp";

export type DetectedImage = {
  mime: PhotoMime;
  extension: PhotoExtension;
};

export class PhotoRequestError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "PhotoRequestError";
    this.status = status;
  }
}

type StoredPhoto = {
  stored: string;
  objectPath: string;
};

export function mediaType(contentType: string | null | undefined): string {
  if (!contentType) return "";
  return contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

export function detectImage(bytes: Uint8Array, contentType: string | null | undefined): DetectedImage | null {
  const mime = mediaType(contentType);
  if (mime === "image/jpeg" && isJpeg(bytes)) return { mime: "image/jpeg", extension: "jpg" };
  if (mime === "image/png" && isPng(bytes)) return { mime: "image/png", extension: "png" };
  if (mime === "image/webp" && isWebp(bytes)) return { mime: "image/webp", extension: "webp" };
  return null;
}

export function stripImageMetadata(bytes: Uint8Array, mime: PhotoMime): Uint8Array {
  if (mime === "image/jpeg") return stripJpeg(bytes);
  if (mime === "image/png") return stripPng(bytes);
  return stripWebp(bytes);
}

export function profilePhotoObjectName(userId: string, extension: PhotoExtension): string {
  return `${userId.toLowerCase()}/avatar.${extension}`;
}

export function profilePhotoStoredValue(objectPath: string): string {
  return `${PROFILE_PHOTO_BUCKET}/${objectPath}`;
}

export function canonicalProfilePhotoValue(
  submitted: string,
  userId: string,
): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof submitted !== "string") return { ok: false, error: PHOTO_REQUIRED_ERROR };
  const value = submitted.trim();
  if (!value) return { ok: false, error: PHOTO_REQUIRED_ERROR };
  if (value.length > 2000) return { ok: false, error: PHOTO_REQUIRED_ERROR };
  const stored = storageReferenceForUser(value, userId);
  if (stored === "foreign") return { ok: false, error: PHOTO_OWNER_ERROR };
  if (stored) return { ok: true, value: stored.stored };
  if (isLegacyHttpUrl(value)) return { ok: true, value };
  return { ok: false, error: PHOTO_OWNER_ERROR };
}

/** Object path inside the bucket when the stored value belongs to subjectUserId. */
export function ownedStorageObjectPath(stored: string | null | undefined, subjectUserId: string): string | null {
  if (typeof stored !== "string") return null;
  const parsed = storageReferenceForUser(stored, subjectUserId);
  if (!parsed || parsed === "foreign") return null;
  return parsed.objectPath;
}

/** Existing http(s) photos stay displayable. Storage paths and signed tokens do not. */
export function legacyPhotoUrl(stored: string | null | undefined): string {
  if (typeof stored !== "string") return "";
  const value = stored.trim();
  if (!isLegacyHttpUrl(value)) return "";
  return value;
}

export function siblingObjectPaths(userId: string, keepPath: string): string[] {
  const names = ["jpg", "jpeg", "png", "webp"].map((extension) => `${userId.toLowerCase()}/avatar.${extension}`);
  return names.filter((name) => name !== keepPath);
}

function storageReferenceForUser(value: string, userId: string): StoredPhoto | "foreign" | null {
  if (typeof value !== "string") return null;
  const key = value.trim().match(STORAGE_KEY);
  if (key?.[1] && key[2]) return storedFor(key[1], key[2], userId);
  if (!/^https?:\/\//i.test(value.trim())) {
    if (value.toLowerCase().includes("profile-photos/")) return "foreign";
    return null;
  }
  try {
    const url = new URL(value.trim());
    const path = url.pathname.match(STORAGE_URL_PATH);
    if (path?.[1] && path[2]) return storedFor(path[1], path[2], userId);
    if (url.pathname.includes("/storage/v1/object/") && url.pathname.includes("/profile-photos/")) {
      return "foreign";
    }
  } catch {
    return null;
  }
  return null;
}

function storedFor(ownerId: string, extension: string, userId: string): StoredPhoto | "foreign" {
  if (ownerId.toLowerCase() !== userId.toLowerCase()) return "foreign";
  const normalized = extension.toLowerCase() === "jpeg" ? "jpeg" : extension.toLowerCase();
  const objectPath = `${ownerId.toLowerCase()}/avatar.${normalized}`;
  return { stored: profilePhotoStoredValue(objectPath), objectPath };
}

function isLegacyHttpUrl(value: string): boolean {
  if (!/^https?:\/\//i.test(value)) return false;
  try {
    const url = new URL(value);
    if (url.username || url.password) return false;
    if (url.pathname.includes("/storage/v1/object/") && url.pathname.includes("/profile-photos/")) return false;
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function isPng(bytes: Uint8Array): boolean {
  return bytes.length >= 8
    && bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47
    && bytes[4] === 0x0d
    && bytes[5] === 0x0a
    && bytes[6] === 0x1a
    && bytes[7] === 0x0a;
}

function isWebp(bytes: Uint8Array): boolean {
  return bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP";
}

function stripJpeg(bytes: Uint8Array): Uint8Array {
  if (!isJpeg(bytes)) throw new PhotoRequestError(PHOTO_TYPE_ERROR);
  const chunks: Uint8Array[] = [bytes.subarray(0, 2)];
  let index = 2;
  while (index < bytes.length) {
    if (bytes[index] !== 0xff) {
      chunks.push(bytes.subarray(index));
      break;
    }
    const markerStart = index;
    index += 1;
    while (index < bytes.length && bytes[index] === 0xff) index += 1;
    if (index >= bytes.length) break;
    const marker = bytes[index] ?? 0;
    index += 1;
    if (marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      chunks.push(Uint8Array.of(0xff, marker));
      continue;
    }
    if (marker === 0xda) {
      chunks.push(bytes.subarray(markerStart));
      break;
    }
    if (index + 1 >= bytes.length) break;
    const length = ((bytes[index] ?? 0) << 8) | (bytes[index + 1] ?? 0);
    if (length < 2 || index + length > bytes.length) {
      chunks.push(bytes.subarray(markerStart));
      break;
    }
    const next = index + length;
    // APP1 is EXIF/XMP. APP13 can carry a Photoshop IRB copy of the same GPS data.
    if (marker !== 0xe1 && marker !== 0xed) chunks.push(bytes.subarray(markerStart, next));
    index = next;
  }
  return concat(chunks);
}

const PNG_TEXT_CHUNKS = new Set(["eXIf", "tEXt", "zTXt", "iTXt", "tIME"]);

function stripPng(bytes: Uint8Array): Uint8Array {
  if (!isPng(bytes)) throw new PhotoRequestError(PHOTO_TYPE_ERROR);
  const chunks: Uint8Array[] = [bytes.subarray(0, 8)];
  let index = 8;
  while (index + 12 <= bytes.length) {
    const length = readU32(bytes, index, false);
    const type = ascii(bytes, index + 4, 4);
    const end = index + 12 + length;
    if (end > bytes.length) break;
    if (!PNG_TEXT_CHUNKS.has(type)) chunks.push(bytes.subarray(index, end));
    index = end;
    if (type === "IEND") break;
  }
  return concat(chunks);
}

function stripWebp(bytes: Uint8Array): Uint8Array {
  if (!isWebp(bytes)) throw new PhotoRequestError(PHOTO_TYPE_ERROR);
  const kept: Uint8Array[] = [];
  let index = 12;
  while (index + 8 <= bytes.length) {
    const type = ascii(bytes, index, 4);
    const size = readU32(bytes, index + 4, true);
    const end = index + 8 + size;
    const padded = end + (size % 2);
    if (end > bytes.length) break;
    if (type !== "EXIF" && type !== "XMP ") kept.push(bytes.subarray(index, Math.min(padded, bytes.length)));
    index = padded;
  }
  const body = concat(kept);
  const file = new Uint8Array(12 + body.length);
  file.set(new TextEncoder().encode("RIFF"), 0);
  writeU32(file, 4, 4 + body.length, true);
  file.set(new TextEncoder().encode("WEBP"), 8);
  file.set(body, 12);
  return file;
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  let value = "";
  for (let index = 0; index < length; index += 1) value += String.fromCharCode(bytes[start + index] ?? 0);
  return value;
}

function readU32(bytes: Uint8Array, start: number, little: boolean): number {
  const one = bytes[start] ?? 0;
  const two = bytes[start + 1] ?? 0;
  const three = bytes[start + 2] ?? 0;
  const four = bytes[start + 3] ?? 0;
  if (little) return (one | (two << 8) | (three << 16) | (four << 24)) >>> 0;
  return ((one << 24) | (two << 16) | (three << 8) | four) >>> 0;
}

function writeU32(bytes: Uint8Array, start: number, value: number, little: boolean): void {
  if (little) {
    bytes[start] = value & 0xff;
    bytes[start + 1] = (value >>> 8) & 0xff;
    bytes[start + 2] = (value >>> 16) & 0xff;
    bytes[start + 3] = (value >>> 24) & 0xff;
    return;
  }
  bytes[start] = (value >>> 24) & 0xff;
  bytes[start + 1] = (value >>> 16) & 0xff;
  bytes[start + 2] = (value >>> 8) & 0xff;
  bytes[start + 3] = value & 0xff;
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const size = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}
