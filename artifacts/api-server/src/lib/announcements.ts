import { randomBytes } from "node:crypto";
import type { Session } from "./session";
import { supabaseJson, supabaseServiceJson, supabaseBody } from "./supabase";

export const PRINCIPLES_VERSION_ERROR = "운영 원칙 버전을 확인해 주세요.";
export const NOTICE_TEXT_ERROR = "공지 제목과 본문을 확인해 주세요.";
export const ACK_FORBIDDEN = "승인된 관장만 운영 원칙을 확인할 수 있습니다.";
export const ACK_VERSION_MISMATCH = "현재 운영 원칙 버전이 아닙니다.";
export const ACK_FAILED = "운영 원칙을 확인하지 못했습니다.";
export const NOTICE_FAILED = "관장 공지를 올리지 못했습니다.";

const PRINCIPLES_VERSION = /^owner-principles-[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type InboxAnnouncement = {
  kind: "principles" | "owner_notice";
  title: string;
  body: string;
  published_at: string;
  notice_version: string;
  is_current: boolean;
  acknowledged_at: string | null;
};

type AnnouncementRow = {
  kind?: unknown;
  title?: unknown;
  body?: unknown;
  published_at?: unknown;
  notice_version?: unknown;
  is_current?: unknown;
};

type AckRow = {
  notice_version?: unknown;
  acknowledged_at?: unknown;
};

export function parsePrinciplesVersion(body: unknown): { ok: true; value: string } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: PRINCIPLES_VERSION_ERROR };
  }
  const record = body as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== 1 || keys[0] !== "notice_version" || typeof record.notice_version !== "string") {
    return { ok: false, error: PRINCIPLES_VERSION_ERROR };
  }
  const noticeVersion = record.notice_version.trim();
  if (!PRINCIPLES_VERSION.test(noticeVersion)) {
    return { ok: false, error: PRINCIPLES_VERSION_ERROR };
  }
  return { ok: true, value: noticeVersion };
}

export function parseOwnerNoticeWrite(body: unknown): { ok: true; value: { title: string; body: string } } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: NOTICE_TEXT_ERROR };
  }
  const record = body as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== 2 || !keys.includes("title") || !keys.includes("body")) {
    return { ok: false, error: NOTICE_TEXT_ERROR };
  }
  if (typeof record.title !== "string" || typeof record.body !== "string") {
    return { ok: false, error: NOTICE_TEXT_ERROR };
  }
  const title = record.title.trim();
  const noticeBody = record.body.trim();
  if (title.length < 1 || title.length > 200 || noticeBody.length < 1 || noticeBody.length > 8000) {
    return { ok: false, error: NOTICE_TEXT_ERROR };
  }
  return { ok: true, value: { title, body: noticeBody } };
}

export function ownerNoticeVersion(now = new Date()): string {
  const stamp = now.toISOString().replace(/\D/g, "").slice(0, 14);
  return `owner-notice-${stamp}-${randomBytes(4).toString("hex")}`;
}

export function acknowledgementError(error: unknown): { status: number; error: string } {
  const message = error instanceof Error ? error.message : "";
  if (/approved_owner_required/i.test(message)) return { status: 403, error: ACK_FORBIDDEN };
  if (/principles_version_mismatch/i.test(message)) return { status: 409, error: ACK_VERSION_MISMATCH };
  if (/authentication_required/i.test(message)) return { status: 401, error: "로그인이 필요합니다." };
  return { status: 400, error: ACK_FAILED };
}

function announcementFromRow(row: AnnouncementRow, acknowledgedAt: string | null): InboxAnnouncement | null {
  if (
    (row.kind !== "principles" && row.kind !== "owner_notice")
    || typeof row.title !== "string"
    || typeof row.body !== "string"
    || typeof row.published_at !== "string"
    || typeof row.notice_version !== "string"
    || typeof row.is_current !== "boolean"
  ) {
    return null;
  }
  return {
    kind: row.kind,
    title: row.title,
    body: row.body,
    published_at: row.published_at,
    notice_version: row.notice_version,
    is_current: row.is_current,
    acknowledged_at: acknowledgedAt,
  };
}

export function sortInbox(rows: InboxAnnouncement[]): InboxAnnouncement[] {
  return [...rows].sort((left, right) => {
    const leftPinned = left.kind === "principles" && left.is_current ? 1 : 0;
    const rightPinned = right.kind === "principles" && right.is_current ? 1 : 0;
    if (leftPinned !== rightPinned) return rightPinned - leftPinned;
    return right.published_at.localeCompare(left.published_at);
  });
}

export async function listInbox(accessToken: string): Promise<InboxAnnouncement[]> {
  const [announcements, acks] = await Promise.all([
    supabaseJson<AnnouncementRow[]>(
      "/rest/v1/announcements?select=kind,title,body,published_at,notice_version,is_current&order=published_at.desc",
      { method: "GET" },
      accessToken,
    ),
    supabaseJson<AckRow[]>(
      "/rest/v1/owner_notice_acknowledgements?select=notice_version,acknowledged_at",
      { method: "GET" },
      accessToken,
    ),
  ]);
  const acknowledged = new Map<string, string>();
  for (const ack of acks) {
    if (typeof ack.notice_version === "string" && typeof ack.acknowledged_at === "string") {
      acknowledged.set(ack.notice_version, ack.acknowledged_at);
    }
  }
  return sortInbox(
    announcements.flatMap((row) => {
      const item = announcementFromRow(row, acknowledged.get(String(row.notice_version)) ?? null);
      return item ? [item] : [];
    }),
  );
}

export async function acknowledgePrinciples(accessToken: string, noticeVersion: string): Promise<string> {
  const payload = await supabaseJson<unknown>(
    "/rest/v1/rpc/acknowledge_owner_principles",
    { method: "POST", body: JSON.stringify({ p_version: noticeVersion }) },
    accessToken,
  );
  if (typeof payload !== "string" || payload.length === 0) {
    throw new Error("acknowledgement_missing");
  }
  return payload;
}

export async function listOwnerNotices(): Promise<InboxAnnouncement[]> {
  const rows = await supabaseServiceJson<AnnouncementRow[]>(
    "/rest/v1/announcements?select=kind,title,body,published_at,notice_version,is_current&kind=eq.owner_notice&order=published_at.desc",
  );
  return rows.flatMap((row) => {
    const item = announcementFromRow(row, null);
    return item ? [item] : [];
  });
}

export async function publishOwnerNotice(
  session: Session,
  notice: { title: string; body: string },
): Promise<InboxAnnouncement> {
  if (!UUID_PATTERN.test(session.user.id)) {
    throw new Error(NOTICE_FAILED);
  }
  const noticeVersion = ownerNoticeVersion();
  const rows = await supabaseServiceJson<AnnouncementRow[]>(
    "/rest/v1/announcements",
    {
      method: "POST",
      ...supabaseBody({
        kind: "owner_notice",
        title: notice.title,
        body: notice.body,
        notice_version: noticeVersion,
        is_current: false,
        author_id: session.user.id,
        published_at: new Date().toISOString(),
      }),
    },
  );
  const published = announcementFromRow(rows[0] ?? {}, null);
  if (!published || published.kind !== "owner_notice") {
    throw new Error(NOTICE_FAILED);
  }
  return { ...published, acknowledged_at: null };
}
