import express, { Router, type NextFunction, type Request, type Response } from "express";
import { AGE_BAND_ERROR, BIRTH_YEAR_LOCKED_ERROR, withAgeFields } from "../lib/age-band";
import { CONSENT_REQUIRED_ERROR, currentConsentsComplete } from "../lib/consents";
import { getProfile, type ProfileRow } from "../lib/data";
import { logger } from "../lib/logger";
import {
  PHOTO_SAVE_ERROR,
  PHOTO_SIZE_ERROR,
  PHOTO_TYPE_ERROR,
  PROFILE_PHOTO_MAX_BYTES,
  PhotoRequestError,
  canonicalProfilePhotoValue,
  mediaType,
} from "../lib/profile-photo";
import {
  deleteReplacedProfilePhoto,
  storeProfilePhoto,
  withDisplayPhoto,
} from "../lib/profile-photo-storage";
import { parseProfileWrite, type ProfileWrite } from "../lib/profile-input";
import { requireSession } from "../lib/session";
import { supabaseJson, supabaseBody } from "../lib/supabase";

const router = Router();

export const PROFILE_SAVE_ERROR = "프로필을 저장하지 못했습니다.";

function postgresSqlState(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("payload" in error)) return undefined;
  const payload = (error as { payload?: unknown }).payload;
  if (!payload || typeof payload !== "object" || !("code" in payload)) return undefined;
  const code = (payload as { code?: unknown }).code;
  return typeof code === "string" && /^[0-9A-Z]{5}$/.test(code) ? code : undefined;
}

function isDatabasePermissionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (/birth_year_locked|birth_year_out_of_band/i.test(error.message)) return false;
  if (/permission denied/i.test(error.message)) return true;
  return postgresSqlState(error) === "42501";
}

function insertProfile(userId: string, value: ProfileWrite) {
  return {
    display_name: value.display_name,
    birth_year: value.birth_year,
    gender: value.gender,
    profile_photo_url: value.profile_photo_url,
    sports: value.sports,
    interests: value.interests,
    bio: value.bio,
    id: userId,
  };
}

const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function readPhotoBody(request: Request, response: Response, next: NextFunction): void {
  if (!PHOTO_TYPES.has(mediaType(request.header("content-type")))) {
    response.status(400).json({ error: PHOTO_TYPE_ERROR });
    return;
  }
  express.raw({ type: () => true, limit: PROFILE_PHOTO_MAX_BYTES })(request, response, (error: unknown) => {
    const typed = error as { type?: string; status?: number } | undefined;
    if (typed && (typed.type === "entity.too.large" || typed.status === 413)) {
      response.status(413).json({ error: PHOTO_SIZE_ERROR });
      return;
    }
    next(error);
  });
}

async function presentSaved(row: ProfileRow | undefined): Promise<ProfileRow | undefined> {
  if (!row) return row;
  return withDisplayPhoto(withAgeFields(row));
}

router.get("/profiles/me", async (request, response) => {
  const session = await requireSession(request, response);
  if (!session) return;
  const profile = await getProfile(session.user.id, session.accessToken);
  if (!profile) {
    response.status(404).json({ error: "프로필을 먼저 만들어 주세요." });
    return;
  }
  response.json(await withDisplayPhoto(profile));
});

router.post("/profiles/me/photo", readPhotoBody, async (request, response) => {
  const session = await requireSession(request, response);
  if (!session) return;
  if (!Buffer.isBuffer(request.body) || request.body.length === 0) {
    response.status(400).json({ error: PHOTO_TYPE_ERROR });
    return;
  }
  try {
    const existing = await getProfile(session.user.id, session.accessToken);
    const uploaded = await storeProfilePhoto({
      userId: session.user.id,
      accessToken: session.accessToken,
      bytes: new Uint8Array(request.body),
      contentType: request.header("content-type") ?? null,
      previous: existing?.profile_photo_url ?? null,
      hasProfile: Boolean(existing),
    });
    response.json(uploaded);
  } catch (error) {
    if (error instanceof PhotoRequestError) {
      response.status(error.status).json({ error: error.message });
      return;
    }
    const code = postgresSqlState(error);
    logger.error({ status: error instanceof Error && "status" in error ? (error as { status?: number }).status : undefined, code }, "profile photo upload failed");
    response.status(400).json({ error: PHOTO_SAVE_ERROR });
  }
});

router.put("/profiles/me", async (request, response) => {
  const session = await requireSession(request, response);
  if (!session) return;
  const parsed = parseProfileWrite(request.body);
  if (!parsed.ok) {
    response.status(400).json({ error: parsed.error });
    return;
  }
  const photo = canonicalProfilePhotoValue(parsed.value.profile_photo_url, session.user.id);
  if (!photo.ok) {
    response.status(400).json({ error: photo.error });
    return;
  }
  const write = { ...parsed.value, profile_photo_url: photo.value };
  try {
    const consented = await currentConsentsComplete(session.accessToken);
    if (!consented) {
      response.status(403).json({ error: CONSENT_REQUIRED_ERROR });
      return;
    }
  } catch (error) {
    logger.error({ err: error }, "Consent lookup failed before profile save");
    response.status(400).json({ error: PROFILE_SAVE_ERROR });
    return;
  }
  try {
    const existing = await getProfile(session.user.id, session.accessToken);
    if (existing?.birth_year != null && write.birth_year !== existing.birth_year) {
      response.status(400).json({ error: BIRTH_YEAR_LOCKED_ERROR });
      return;
    }
    // authenticated can INSERT profiles.id and cannot UPDATE it or is_admin.
    // An upsert that sets id is rejected for a new row and an existing row.
    const rows = existing
      ? await supabaseJson<ProfileRow[]>(
          `/rest/v1/profiles?id=eq.${encodeURIComponent(session.user.id)}`,
          { method: "PATCH", ...supabaseBody(write) },
          session.accessToken,
        )
      : await supabaseJson<ProfileRow[]>(
          "/rest/v1/profiles",
          { method: "POST", ...supabaseBody(insertProfile(session.user.id, write)) },
          session.accessToken,
        );
    const saved = Array.isArray(rows) ? rows[0] : rows;
    if (saved) {
      await deleteReplacedProfilePhoto(
        existing?.profile_photo_url,
        saved.profile_photo_url,
        session.user.id,
        session.accessToken,
      );
    }
    response.json(await presentSaved(saved));
  } catch (error) {
    const message = error instanceof Error ? error.message : "프로필 저장에 실패했습니다.";
    if (/consent_required/i.test(message)) {
      response.status(403).json({ error: CONSENT_REQUIRED_ERROR });
      return;
    }
    if (/birth_year_locked/i.test(message)) {
      response.status(400).json({ error: BIRTH_YEAR_LOCKED_ERROR });
      return;
    }
    if (/birth_year_out_of_band/i.test(message)) {
      response.status(400).json({ error: AGE_BAND_ERROR });
      return;
    }
    if (isDatabasePermissionError(error)) {
      const code = postgresSqlState(error);
      logger.error(code ? { code } : {}, "profile save rejected by database privileges");
      response.status(400).json({ error: PROFILE_SAVE_ERROR });
      return;
    }
    response.status(400).json({ error: message });
  }
});

export default router;