import { logger } from "./logger";
import { supabaseJson } from "./supabase";

export const CONSENT_REQUIRED_ERROR =
  "이용약관, 개인정보 수집·이용, 국외 이전에 모두 동의해 주세요.";
export const GYM_OWNER_DELETE_ERROR =
  "예정된 클래스가 있는 체육관의 관장은 탈퇴할 수 없어요. 예정된 클래스를 취소하거나, 운영자에게 관장 권한 이전을 요청한 뒤 다시 탈퇴해 주세요.";
export const DELETE_CONFIRMATION = "탈퇴";

export type ConsentKind = "terms" | "privacy" | "overseas_transfer";

export type ConsentRecord = {
  kind: ConsentKind;
  version: string;
  accepted_at: string;
};

export type ConsentFlags = {
  terms: true;
  privacy: true;
  overseas_transfer: true;
};

const KINDS = new Set<string>(["terms", "privacy", "overseas_transfer"]);

export function readConsentFlags(body: unknown): ConsentFlags | null {
  if (!body || typeof body !== "object") return null;
  const value = body as Record<string, unknown>;
  if (value.terms !== true || value.privacy !== true || value.overseas_transfer !== true) return null;
  return { terms: true, privacy: true, overseas_transfer: true };
}

export function readDeleteConfirmation(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  return (body as Record<string, unknown>).confirm === DELETE_CONFIRMATION;
}

export function publicConsentRecords(payload: unknown): ConsentRecord[] {
  if (!Array.isArray(payload)) return [];
  return payload.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const value = row as Record<string, unknown>;
    if (typeof value.kind !== "string" || !KINDS.has(value.kind)) return [];
    if (typeof value.version !== "string" || typeof value.accepted_at !== "string") return [];
    return [{
      kind: value.kind as ConsentKind,
      version: value.version,
      accepted_at: value.accepted_at,
    }];
  });
}

export async function currentConsentsComplete(accessToken: string): Promise<boolean> {
  const value = await supabaseJson<unknown>(
    "/rest/v1/rpc/current_consents_complete",
    { method: "POST", body: "{}" },
    accessToken,
  );
  return value === true;
}

export async function consentsForSession(accessToken: string): Promise<boolean> {
  try {
    return await currentConsentsComplete(accessToken);
  } catch (error) {
    logger.error({ err: error }, "Consent lookup failed");
    return false;
  }
}

export async function recordOwnConsents(
  accessToken: string,
  flags: ConsentFlags,
): Promise<ConsentRecord[]> {
  const payload = await supabaseJson<unknown>(
    "/rest/v1/rpc/record_own_consents",
    {
      method: "POST",
      body: JSON.stringify({
        p_terms: flags.terms,
        p_privacy: flags.privacy,
        p_overseas: flags.overseas_transfer,
      }),
    },
    accessToken,
  );
  return publicConsentRecords(payload);
}
