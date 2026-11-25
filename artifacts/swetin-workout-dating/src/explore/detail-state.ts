import type { ClassDetail } from "@workspace/api-client-react";

/**
 * Matches join_class and the list API: a class has started when
 * scheduled_at <= now(). scheduled_at is an instant (timestamptz / ISO),
 * so compare UTC milliseconds. Do not compare KST calendar strings.
 */
export function classHasStarted(scheduledAt: string | Date | null | undefined, nowMs = Date.now()): boolean {
  if (scheduledAt == null) return false;
  const startMs = scheduledAt instanceof Date ? scheduledAt.getTime() : Date.parse(scheduledAt);
  if (Number.isNaN(startMs)) return true;
  return startMs <= nowMs;
}

export type SampleState = "default" | "joined" | "completed" | "cancelled" | "draft";
export const SAMPLE_STATES: SampleState[] = ["default", "joined", "completed", "cancelled", "draft"];
export const SAMPLE_STATE_LABEL: Record<SampleState, string> = { default: "기본", joined: "신청 완료", completed: "운동 완료", cancelled: "취소됨", draft: "준비 중" };

export function parseSampleState(v: string | null | undefined): SampleState | null {
  return SAMPLE_STATES.includes(v as SampleState) ? (v as SampleState) : null;
}

/** Display-only override for sample details. Keeps counts consistent. */
export function applySampleState(item: ClassDetail, s: SampleState): ClassDetail {
  switch (s) {
    case "joined": return item.is_joined ? item : { ...item, is_joined: true };
    case "completed": return { ...item, status: "completed" };
    case "cancelled": return { ...item, status: "cancelled" };
    case "draft": return { ...item, status: "draft" };
    default: return item;
  }
}

export type CtaKind = "open" | "closed" | "completed" | "unavailable" | "joined" | "gender-full";
export type CtaState = { kind: CtaKind; label: string; disabled: boolean };

export const STATUS_BADGE: Record<string, string> = { published: "모집 중", completed: "운동 완료", cancelled: "취소됨", draft: "준비 중" };

export function getDetailCtaState(p: { status: string; isJoined: boolean; remaining: number; scheduledAt?: string | Date; genderBlocked?: boolean; genderLabel?: string }, nowMs = Date.now()): CtaState {
  if (p.status === "completed") return { kind: "completed", label: "운동 완료", disabled: true };
  if (p.status !== "published") return { kind: "unavailable", label: "참가 불가", disabled: true };
  if (p.isJoined) return { kind: "joined", label: "신청 완료", disabled: true };
  if (p.genderBlocked) return { kind: "gender-full", label: `${p.genderLabel ?? ""} 정원 마감 (샘플)`.trim(), disabled: true };
  if (p.remaining < 1 || classHasStarted(p.scheduledAt, nowMs)) return { kind: "closed", label: "모집 마감", disabled: true };
  return { kind: "open", label: "참가 신청하기", disabled: false };
}

export function recruitmentBadge(status: string, remaining: number, scheduledAt?: string | Date, nowMs = Date.now()): string | undefined {
  if (status === "published" && (remaining < 1 || classHasStarted(scheduledAt, nowMs))) return "모집 마감";
  return STATUS_BADGE[status];
}
