export type InboxAnnouncement = {
  kind: "principles" | "owner_notice";
  title: string;
  body: string;
  published_at: string;
  notice_version: string;
  is_current: boolean;
  acknowledged_at: string | null;
};

function isAnnouncement(value: unknown): value is InboxAnnouncement {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (row.kind === "principles" || row.kind === "owner_notice")
    && typeof row.title === "string"
    && typeof row.body === "string"
    && typeof row.published_at === "string"
    && typeof row.notice_version === "string"
    && typeof row.is_current === "boolean"
    && (row.acknowledged_at === null || typeof row.acknowledged_at === "string");
}

export function readInbox(payload: unknown): InboxAnnouncement[] {
  if (!payload || typeof payload !== "object") return [];
  const rows = (payload as { announcements?: unknown }).announcements;
  if (!Array.isArray(rows)) return [];
  return rows.filter(isAnnouncement);
}

export function currentUnackedPrinciples(rows: InboxAnnouncement[]): InboxAnnouncement | null {
  return rows.find((row) => row.kind === "principles" && row.is_current && !row.acknowledged_at) ?? null;
}

export function noticeParagraphs(body: string): string[] {
  const parts = body.split(/\n\n+/).map((part) => part.trim()).filter(Boolean);
  return parts.length ? parts : [body];
}

export function formatAcknowledgedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "확인 시각을 읽지 못했습니다.";
  const formatted = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
  return `확인 ${formatted}`;
}
