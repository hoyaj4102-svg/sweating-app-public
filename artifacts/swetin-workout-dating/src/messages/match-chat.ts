/** Same limits as the API and the DB constraints. */
export const MATCH_MESSAGE_MAX_LENGTH = 1000;
export const MATCH_REPORT_DETAIL_MAX_LENGTH = 500;

export const MATCH_REPORT_OPTIONS = [
  { value: "harassment", label: "욕설·비방·괴롭힘" },
  { value: "spam", label: "스팸·광고·홍보" },
  { value: "inappropriate", label: "불쾌하거나 부적절한 언행" },
  { value: "impersonation", label: "사칭·허위 정보" },
  { value: "other", label: "기타" },
] as const;

export type MatchReportReason = (typeof MATCH_REPORT_OPTIONS)[number]["value"];

export type MatchChatMessage = {
  id: string;
  body: string;
  created_at: string;
  is_mine: boolean;
};

export type MatchChatBlockStatus = {
  is_blocked: boolean;
  blocked_by_me: boolean;
};

function isMessage(value: unknown): value is MatchChatMessage {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === "string"
    && typeof row.body === "string"
    && typeof row.created_at === "string"
    && typeof row.is_mine === "boolean";
}

export function readMatchMessages(payload: unknown): MatchChatMessage[] {
  if (!payload || typeof payload !== "object") return [];
  const rows = (payload as { messages?: unknown }).messages;
  if (!Array.isArray(rows)) return [];
  return rows.filter(isMessage);
}

export function readBlockStatus(payload: unknown): MatchChatBlockStatus | null {
  if (!payload || typeof payload !== "object") return null;
  const source = "block" in payload ? (payload as { block?: unknown }).block : payload;
  if (!source || typeof source !== "object") return null;
  const row = source as Record<string, unknown>;
  if (typeof row.is_blocked !== "boolean" || typeof row.blocked_by_me !== "boolean") {
    return null;
  }
  return { is_blocked: row.is_blocked, blocked_by_me: row.blocked_by_me };
}

export function readSentMessage(payload: unknown): MatchChatMessage | null {
  if (!payload || typeof payload !== "object") return null;
  const row = (payload as { message?: unknown }).message;
  return isMessage(row) ? row : null;
}

/** Characters as the server counts them (code points). */
export function messageLength(value: string): number {
  return [...value.trim()].length;
}

export function canSendMessage(value: string): boolean {
  const length = messageLength(value);
  return length >= 1 && length <= MATCH_MESSAGE_MAX_LENGTH;
}

export function canSubmitReportDetail(value: string): boolean {
  return messageLength(value) <= MATCH_REPORT_DETAIL_MAX_LENGTH;
}

/** Appends a sent message once, keeping server order. */
export function appendMessage(rows: MatchChatMessage[], message: MatchChatMessage): MatchChatMessage[] {
  return rows.some((row) => row.id === message.id) ? rows : [...rows, message];
}

export function formatMessageTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

export async function errorFromResponse(result: Response, fallback: string): Promise<string> {
  try {
    const payload = await result.json() as { error?: unknown };
    return typeof payload.error === "string" && payload.error ? payload.error : fallback;
  } catch {
    return fallback;
  }
}
