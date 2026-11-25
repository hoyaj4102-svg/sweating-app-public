import type { Response } from "express";
import type { Session } from "./session";
import { supabaseJson, supabaseServiceJson } from "./supabase";

export const OWNER_FORBIDDEN = "이 체육관의 관장만 사용할 수 있습니다.";
export const OWNER_CLASS_MISSING = "클래스를 찾을 수 없습니다.";
export const OWNER_GYM_MISSING = "체육관을 찾을 수 없습니다.";
export const ACCOUNT_NOT_FOUND = "해당 계정을 찾지 못했습니다.";
export const OWNER_EXISTS = "이미 관장이 지정되어 있습니다. 바꾸려면 먼저 해제해 주세요.";
export const OWNER_EMAIL_ERROR = "계정 이메일을 확인해 주세요.";
export const GYM_MOVE_ERROR = "클래스는 다른 체육관으로 옮길 수 없습니다.";
export const OWNER_CLASS_LOCKED = "완료되었거나 취소된 클래스는 수정할 수 없습니다.";
export const OWNER_CREATE_STATUS_ERROR = "새 클래스는 초안 또는 공개로 만듭니다.";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type OwnedClass = {
  id: string;
  gym_id: string;
  status: string;
};

export type GymOwnerSummary = {
  user_id: string;
  display_name: string | null;
};

export function parseOwnerEmail(body: unknown): { ok: true; value: string } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: OWNER_EMAIL_ERROR };
  }
  const record = body as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== 1 || keys[0] !== "email" || typeof record.email !== "string") {
    return { ok: false, error: OWNER_EMAIL_ERROR };
  }
  const email = record.email.trim().toLowerCase();
  if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: OWNER_EMAIL_ERROR };
  }
  return { ok: true, value: email };
}

function idsFromRpc(payload: unknown): string[] {
  if (!Array.isArray(payload)) return [];
  const ids: string[] = [];
  for (const item of payload) {
    if (typeof item === "string" && UUID_PATTERN.test(item)) {
      ids.push(item);
      continue;
    }
    if (item && typeof item === "object" && "owned_gym_ids" in item) {
      const value = (item as { owned_gym_ids: unknown }).owned_gym_ids;
      if (typeof value === "string" && UUID_PATTERN.test(value)) ids.push(value);
    }
  }
  return ids;
}

export async function listOwnedGymIds(session: Session): Promise<string[]> {
  const payload = await supabaseJson<unknown>(
    "/rest/v1/rpc/owned_gym_ids",
    { method: "POST", body: "{}" },
    session.accessToken,
  );
  return idsFromRpc(payload);
}

export async function loadClassGym(classId: string): Promise<OwnedClass | null> {
  const rows = await supabaseServiceJson<OwnedClass[]>(
    `/rest/v1/classes?select=id,gym_id,status&id=eq.${encodeURIComponent(classId)}&limit=1`,
  );
  return rows[0] ?? null;
}

export async function requireOwnedGym(
  session: Session,
  gymId: string,
  response: Response,
): Promise<boolean> {
  const owned = await listOwnedGymIds(session);
  if (!owned.includes(gymId)) {
    response.status(403).json({ error: OWNER_FORBIDDEN });
    return false;
  }
  return true;
}

/** Missing classes are 404. Another gym, or a caller who owns nothing, is 403. */
export async function requireOwnedClass(
  session: Session,
  classId: string,
  response: Response,
): Promise<OwnedClass | null> {
  const owned = await listOwnedGymIds(session);
  if (!owned.length) {
    response.status(403).json({ error: OWNER_FORBIDDEN });
    return null;
  }
  const row = await loadClassGym(classId);
  if (!row) {
    response.status(404).json({ error: OWNER_CLASS_MISSING });
    return null;
  }
  if (!owned.includes(row.gym_id)) {
    response.status(403).json({ error: OWNER_FORBIDDEN });
    return null;
  }
  return row;
}

export function rosterRows(payload: unknown): Array<{
  id: string;
  user_id: string;
  attendance_status: string;
  display_name: string | null;
}> {
  if (!Array.isArray(payload)) return [];
  return payload.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (typeof row.id !== "string" || typeof row.user_id !== "string" || typeof row.attendance_status !== "string") {
      return [];
    }
    return [{
      id: row.id,
      user_id: row.user_id,
      attendance_status: row.attendance_status,
      display_name: typeof row.display_name === "string" ? row.display_name : null,
    }];
  });
}

/** Drops payment and profile photo fields from an owner-facing payload. */
export function withoutPaymentFields(body: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(body).filter(([key]) => !/payment/i.test(key) && !/profile_photo/i.test(key)),
  );
}

export async function lookupUserIdByEmail(email: string): Promise<string | null> {
  const found = await supabaseServiceJson<unknown>(
    "/rest/v1/rpc/lookup_user_id_by_email",
    { method: "POST", body: JSON.stringify({ p_email: email }) },
  );
  return typeof found === "string" && UUID_PATTERN.test(found) ? found : null;
}

export async function readGymOwner(gymId: string): Promise<GymOwnerSummary | null> {
  const rows = await supabaseServiceJson<Array<{ user_id: string }>>(
    `/rest/v1/gym_owners?select=user_id&gym_id=eq.${encodeURIComponent(gymId)}&limit=1`,
  );
  const userId = rows[0]?.user_id;
  if (!userId) return null;
  const profiles = await supabaseServiceJson<Array<{ display_name: string | null }>>(
    `/rest/v1/profiles?select=display_name&id=eq.${encodeURIComponent(userId)}&limit=1`,
  );
  return {
    user_id: userId,
    display_name: profiles[0]?.display_name ?? null,
  };
}
