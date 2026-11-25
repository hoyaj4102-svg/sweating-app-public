import { Router } from "express";
import { deleteOwnedProfilePhotos, ProfilePhotoDeletionError } from "../lib/account-photos";
import {
  CONSENT_REQUIRED_ERROR,
  GYM_OWNER_DELETE_ERROR,
  consentsForSession,
  readConsentFlags,
  readDeleteConfirmation,
  recordOwnConsents,
} from "../lib/consents";
import { getProfile } from "../lib/data";
import { clearSessionCookie, requireSession, signOut } from "../lib/session";
import { supabaseJson } from "../lib/supabase";

const router = Router();
const DELETE_FAILED = "계정을 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "";
}

function deletionFailure(error: unknown): { status: number; message: string } | null {
  const message = errorMessage(error);
  if (/gym_owner_upcoming_classes/i.test(message)) {
    return { status: 409, message: GYM_OWNER_DELETE_ERROR };
  }
  if (/not_authenticated/i.test(message)) {
    return { status: 401, message: "로그인이 필요합니다." };
  }
  return null;
}

router.post("/account/consents", async (request, response) => {
  const session = await requireSession(request, response);
  if (!session) return;
  const flags = readConsentFlags(request.body);
  if (!flags) {
    response.status(400).json({ error: CONSENT_REQUIRED_ERROR });
    return;
  }
  try {
    const records = await recordOwnConsents(session.accessToken, flags);
    const consentsCurrent = records.length === 3
      ? true
      : await consentsForSession(session.accessToken);
    response.status(200).json({ consents_current: consentsCurrent, records });
  } catch (error) {
    if (/consent_required/i.test(errorMessage(error))) {
      response.status(400).json({ error: CONSENT_REQUIRED_ERROR });
      return;
    }
    request.log.error({ err: error }, "Consent record failed");
    response.status(400).json({ error: CONSENT_REQUIRED_ERROR });
  }
});

router.post("/account/deletion", async (request, response) => {
  const session = await requireSession(request, response);
  if (!session) return;
  if (!readDeleteConfirmation(request.body)) {
    response.status(400).json({ error: "탈퇴를 확인하려면 확인 문구를 입력해 주세요." });
    return;
  }
  try {
    await supabaseJson(
      "/rest/v1/rpc/assert_own_account_deletable",
      { method: "POST", body: "{}" },
      session.accessToken,
    );
  } catch (error) {
    const mapped = deletionFailure(error);
    if (mapped) {
      response.status(mapped.status).json({ error: mapped.message });
      return;
    }
    request.log.error({ err: error }, "Account deletion check failed");
    response.status(400).json({ error: DELETE_FAILED });
    return;
  }

  let storedPhoto: string | null = null;
  try {
    const profile = await getProfile(session.user.id, session.accessToken);
    storedPhoto = profile?.profile_photo_url ?? null;
  } catch (error) {
    request.log.error({ err: error }, "Profile lookup failed before account deletion");
    response.status(400).json({ error: DELETE_FAILED });
    return;
  }

  try {
    await deleteOwnedProfilePhotos(session.user.id, storedPhoto);
  } catch (error) {
    const status = error instanceof ProfilePhotoDeletionError ? error.status : 0;
    request.log.error({ status }, "Profile photo deletion failed; account was kept");
    response.status(400).json({ error: DELETE_FAILED });
    return;
  }

  try {
    await supabaseJson(
      "/rest/v1/rpc/delete_own_account",
      { method: "POST", body: "{}" },
      session.accessToken,
    );
  } catch (error) {
    const mapped = deletionFailure(error);
    request.log.error(
      { status: mapped?.status ?? 400 },
      "Account deletion failed after profile photos were removed",
    );
    if (mapped) {
      response.status(mapped.status).json({ error: mapped.message });
      return;
    }
    response.status(400).json({ error: DELETE_FAILED });
    return;
  }

  try {
    await signOut(session);
  } catch (error) {
    request.log.warn({ err: error }, "Sign-out after account deletion failed");
  }
  clearSessionCookie(response);
  response.status(200).json({ deleted: true });
});

export default router;
