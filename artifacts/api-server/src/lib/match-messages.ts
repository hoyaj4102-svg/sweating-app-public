import { supabaseJson, supabaseServiceJson } from "./supabase";

/** Same limits as the DB constraints and private.send_match_message / private.report_match_chat. */
export const MATCH_MESSAGE_MAX_LENGTH = 1000;
export const MATCH_MESSAGE_PAGE_SIZE = 50;
export const MATCH_MESSAGE_RATE_LIMIT_PER_MINUTE = 10;
export const MATCH_MESSAGE_RATE_LIMIT_PER_DAY = 100;
export const MATCH_REPORT_DETAIL_MAX_LENGTH = 500;

export const MATCH_REPORT_REASONS = [
  "harassment",
  "spam",
  "inappropriate",
  "impersonation",
  "other",
] as const;

export type MatchReportReason = (typeof MATCH_REPORT_REASONS)[number];

export const MATCH_MESSAGE_TEXT_ERROR = `메시지는 1자 이상 ${MATCH_MESSAGE_MAX_LENGTH}자 이하로 입력해 주세요.`;
export const MATCH_CHAT_FORBIDDEN = "이 매치에서는 대화할 수 없습니다.";
export const MATCH_CHAT_BLOCKED = "대화가 차단되어 메시지를 보낼 수 없습니다.";
export const MATCH_CHAT_UNBLOCK_FORBIDDEN = "차단한 사람만 차단을 해제할 수 있습니다.";
export const MATCH_CHAT_RATE_LIMIT_MINUTE = `잠시 후 다시 보내 주세요. 1분에 최대 ${MATCH_MESSAGE_RATE_LIMIT_PER_MINUTE}개까지 보낼 수 있습니다.`;
export const MATCH_CHAT_RATE_LIMIT_DAY = `오늘 보낼 수 있는 메시지 한도(하루 ${MATCH_MESSAGE_RATE_LIMIT_PER_DAY}개)를 모두 사용했습니다.`;
export const MATCH_REPORT_REASON_ERROR = "신고 사유를 선택해 주세요.";
export const MATCH_REPORT_DETAIL_ERROR = `신고 내용은 ${MATCH_REPORT_DETAIL_MAX_LENGTH}자 이하로 입력해 주세요.`;
export const MATCH_REPORT_MESSAGE_NOT_FOUND = "신고하려는 메시지를 찾을 수 없습니다.";
export const MATCH_NOT_FOUND = "매치를 찾을 수 없습니다.";
export const MATCH_MESSAGES_FAILED = "메시지를 불러오지 못했습니다.";
export const MATCH_MESSAGE_SEND_FAILED = "메시지를 보내지 못했습니다.";
export const MATCH_BLOCK_FAILED = "차단 상태를 변경하지 못했습니다.";
export const MATCH_REPORT_FAILED = "신고를 접수하지 못했습니다.";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REPORT_KEYS = new Set(["reason", "detail", "message_id"]);

export type MatchMessage = {
  id: string;
  body: string;
  created_at: string;
  is_mine: boolean;
};

export type MatchChatBlockStatus = {
  is_blocked: boolean;
  blocked_by_me: boolean;
};

export type MatchChatReportReceipt = {
  id: string;
  created_at: string;
};

export type MatchChatReportInput = {
  reason: MatchReportReason;
  detail: string | null;
  message_id: string | null;
};

export type AdminMatchReport = {
  id: string;
  match_id: string;
  message_id: string | null;
  reporter_id: string;
  reported_user_id: string;
  reason: string;
  detail: string | null;
  created_at: string;
};

type MatchMessageRow = {
  id?: unknown;
  match_id?: unknown;
  sender_id?: unknown;
  body?: unknown;
  created_at?: unknown;
};

type MatchMembersRow = {
  id: string;
  user_a_id: string;
  user_b_id: string;
};

export class MatchChatError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function isMatchId(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

/** Characters as Postgres char_length counts them (code points), not UTF-16 units. */
export function messageLength(value: string): number {
  return [...value].length;
}

export function parseMatchMessageWrite(body: unknown): { ok: true; value: string } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: MATCH_MESSAGE_TEXT_ERROR };
  }
  const record = body as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== 1 || keys[0] !== "body" || typeof record.body !== "string") {
    return { ok: false, error: MATCH_MESSAGE_TEXT_ERROR };
  }
  const text = record.body.trim();
  const length = messageLength(text);
  if (length < 1 || length > MATCH_MESSAGE_MAX_LENGTH) {
    return { ok: false, error: MATCH_MESSAGE_TEXT_ERROR };
  }
  return { ok: true, value: text };
}

export function parseMatchReportWrite(
  body: unknown,
): { ok: true; value: MatchChatReportInput } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: MATCH_REPORT_REASON_ERROR };
  }
  const record = body as Record<string, unknown>;
  const keys = Object.keys(record);
  if (!keys.length || keys.some((key) => !REPORT_KEYS.has(key))) {
    return { ok: false, error: MATCH_REPORT_REASON_ERROR };
  }
  if (
    typeof record.reason !== "string"
    || !(MATCH_REPORT_REASONS as readonly string[]).includes(record.reason.trim())
  ) {
    return { ok: false, error: MATCH_REPORT_REASON_ERROR };
  }
  const reason = record.reason.trim() as MatchReportReason;

  let detail: string | null = null;
  if (record.detail !== undefined && record.detail !== null) {
    if (typeof record.detail !== "string") {
      return { ok: false, error: MATCH_REPORT_DETAIL_ERROR };
    }
    const trimmed = record.detail.trim();
    if (trimmed.length > 0) {
      if (messageLength(trimmed) > MATCH_REPORT_DETAIL_MAX_LENGTH) {
        return { ok: false, error: MATCH_REPORT_DETAIL_ERROR };
      }
      detail = trimmed;
    }
  }

  let messageId: string | null = null;
  if (record.message_id !== undefined && record.message_id !== null) {
    if (!isMatchId(record.message_id)) {
      return { ok: false, error: MATCH_REPORT_MESSAGE_NOT_FOUND };
    }
    messageId = record.message_id;
  }

  return { ok: true, value: { reason, detail, message_id: messageId } };
}

export function parseBefore(value: unknown): { ok: true; value: string | null } | { ok: false } {
  if (value === undefined) return { ok: true, value: null };
  if (typeof value !== "string" || value.length > 40) return { ok: false };
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return { ok: false };
  return { ok: true, value: new Date(parsed).toISOString() };
}

export function toMatchMessage(row: MatchMessageRow, userId: string): MatchMessage | null {
  if (
    typeof row.id !== "string"
    || typeof row.body !== "string"
    || typeof row.created_at !== "string"
    || typeof row.sender_id !== "string"
  ) {
    return null;
  }
  return {
    id: row.id,
    body: row.body,
    created_at: row.created_at,
    is_mine: row.sender_id === userId,
  };
}

function toBlockStatus(payload: unknown): MatchChatBlockStatus {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error(MATCH_BLOCK_FAILED);
  }
  const row = payload as Record<string, unknown>;
  if (typeof row.is_blocked !== "boolean" || typeof row.blocked_by_me !== "boolean") {
    throw new Error(MATCH_BLOCK_FAILED);
  }
  return { is_blocked: row.is_blocked, blocked_by_me: row.blocked_by_me };
}

/** Maps the database's raised codes to an HTTP status and a Korean message. */
export function matchChatError(error: unknown, fallback: string): { status: number; error: string } {
  if (error instanceof MatchChatError) return { status: error.status, error: error.message };
  const message = error instanceof Error ? error.message : "";
  if (/authentication_required/i.test(message)) return { status: 401, error: "로그인이 필요합니다." };
  if (/match_chat_unblock_forbidden/i.test(message)) return { status: 403, error: MATCH_CHAT_UNBLOCK_FORBIDDEN };
  if (/match_chat_blocked/i.test(message)) return { status: 403, error: MATCH_CHAT_BLOCKED };
  if (/match_chat_forbidden/i.test(message)) return { status: 403, error: MATCH_CHAT_FORBIDDEN };
  if (/match_chat_rate_limit_minute/i.test(message)) return { status: 429, error: MATCH_CHAT_RATE_LIMIT_MINUTE };
  if (/match_chat_rate_limit_day/i.test(message)) return { status: 429, error: MATCH_CHAT_RATE_LIMIT_DAY };
  if (/report_reason_invalid|match_chat_reports_reason_check/i.test(message)) return { status: 400, error: MATCH_REPORT_REASON_ERROR };
  if (/report_detail_too_long|match_chat_reports_detail_length/i.test(message)) return { status: 400, error: MATCH_REPORT_DETAIL_ERROR };
  if (/report_message_not_found/i.test(message)) return { status: 404, error: MATCH_REPORT_MESSAGE_NOT_FOUND };
  if (/message_invalid|match_messages_body_length/i.test(message)) return { status: 400, error: MATCH_MESSAGE_TEXT_ERROR };
  return { status: 500, error: fallback };
}

/**
 * Server-side membership check before the database call. The database
 * repeats it, adds the class-end and both-attended rules, and is the
 * authority. Only the two ids of the match row are read here.
 */
export async function assertMatchMember(matchId: string, userId: string): Promise<void> {
  if (!isMatchId(matchId) || !isMatchId(userId)) {
    throw new MatchChatError(404, MATCH_NOT_FOUND);
  }
  const rows = await supabaseServiceJson<MatchMembersRow[]>(
    `/rest/v1/matches?select=id,user_a_id,user_b_id&id=eq.${encodeURIComponent(matchId)}&limit=1`,
  );
  const match = rows[0];
  if (!match) throw new MatchChatError(404, MATCH_NOT_FOUND);
  if (match.user_a_id !== userId && match.user_b_id !== userId) {
    throw new MatchChatError(403, MATCH_CHAT_FORBIDDEN);
  }
}

/** Oldest first, at most one page. Runs with the member's own token so RLS and the definer check apply. */
export async function listMatchMessages(
  accessToken: string,
  userId: string,
  matchId: string,
  before: string | null,
): Promise<MatchMessage[]> {
  await assertMatchMember(matchId, userId);
  const rows = await supabaseJson<MatchMessageRow[]>(
    "/rest/v1/rpc/list_match_messages",
    {
      method: "POST",
      body: JSON.stringify({ p_match_id: matchId, p_limit: MATCH_MESSAGE_PAGE_SIZE, p_before: before }),
    },
    accessToken,
  );
  if (!Array.isArray(rows)) throw new Error(MATCH_MESSAGES_FAILED);
  return rows
    .flatMap((row) => {
      const message = toMatchMessage(row, userId);
      return message ? [message] : [];
    })
    .reverse();
}

export async function getMatchChatStatus(
  accessToken: string,
  userId: string,
  matchId: string,
): Promise<MatchChatBlockStatus> {
  await assertMatchMember(matchId, userId);
  const payload = await supabaseJson<unknown>(
    "/rest/v1/rpc/get_match_chat_status",
    { method: "POST", body: JSON.stringify({ p_match_id: matchId }) },
    accessToken,
  );
  return toBlockStatus(payload);
}

export async function sendMatchMessage(
  accessToken: string,
  userId: string,
  matchId: string,
  body: string,
): Promise<MatchMessage> {
  await assertMatchMember(matchId, userId);
  const payload = await supabaseJson<MatchMessageRow | MatchMessageRow[]>(
    "/rest/v1/rpc/send_match_message",
    { method: "POST", body: JSON.stringify({ p_match_id: matchId, p_body: body }) },
    accessToken,
  );
  const row = Array.isArray(payload) ? payload[0] : payload;
  const message = row ? toMatchMessage(row, userId) : null;
  if (!message || !message.is_mine) throw new Error(MATCH_MESSAGE_SEND_FAILED);
  return message;
}

export async function blockMatchChat(
  accessToken: string,
  userId: string,
  matchId: string,
): Promise<MatchChatBlockStatus> {
  await assertMatchMember(matchId, userId);
  const payload = await supabaseJson<unknown>(
    "/rest/v1/rpc/block_match_chat",
    { method: "POST", body: JSON.stringify({ p_match_id: matchId }) },
    accessToken,
  );
  return toBlockStatus(payload);
}

export async function unblockMatchChat(
  accessToken: string,
  userId: string,
  matchId: string,
): Promise<MatchChatBlockStatus> {
  await assertMatchMember(matchId, userId);
  const payload = await supabaseJson<unknown>(
    "/rest/v1/rpc/unblock_match_chat",
    { method: "POST", body: JSON.stringify({ p_match_id: matchId }) },
    accessToken,
  );
  return toBlockStatus(payload);
}

export async function reportMatchChat(
  accessToken: string,
  userId: string,
  matchId: string,
  input: MatchChatReportInput,
): Promise<MatchChatReportReceipt> {
  await assertMatchMember(matchId, userId);
  const payload = await supabaseJson<unknown>(
    "/rest/v1/rpc/report_match_chat",
    {
      method: "POST",
      body: JSON.stringify({
        p_match_id: matchId,
        p_reason: input.reason,
        p_detail: input.detail,
        p_message_id: input.message_id,
      }),
    },
    accessToken,
  );
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error(MATCH_REPORT_FAILED);
  }
  const row = payload as Record<string, unknown>;
  if (typeof row.id !== "string" || typeof row.created_at !== "string") {
    throw new Error(MATCH_REPORT_FAILED);
  }
  return { id: row.id, created_at: row.created_at };
}

export async function listAdminMatchReports(accessToken: string): Promise<AdminMatchReport[]> {
  const rows = await supabaseJson<unknown>(
    "/rest/v1/match_chat_reports?select=id,match_id,message_id,reporter_id,reported_user_id,reason,detail,created_at&order=created_at.desc,id.desc&limit=100",
    { method: "GET" },
    accessToken,
  );
  if (!Array.isArray(rows)) return [];
  return rows as AdminMatchReport[];
}
