const MINUTE_MS = 60_000;

export const REVEALED_ATTENDANCE_STATUS = "attended";

export const REVEAL_WAITING_MESSAGE = "참가자 정보는 운동이 끝난 뒤 공개됩니다.";

export const REVEAL_ATTENDANCE_MESSAGE = "함께 출석한 참가자만 프로필을 볼 수 있습니다.";

export const REVEAL_OPEN_MESSAGE = "오늘 함께 운동한 사람들";

/** Scheduled end is scheduled_at + duration_minutes. Invalid inputs fail closed. */
export function classScheduledEndMs(scheduledAt: string, durationMinutes: number): number {
  const startMs = Date.parse(scheduledAt);
  if (!Number.isFinite(startMs) || !Number.isFinite(durationMinutes) || durationMinutes <= 0) {
    return Number.NaN;
  }
  return startMs + durationMinutes * MINUTE_MS;
}

/**
 * Profiles stay hidden until the class is completed AND the scheduled end has
 * passed. Completing early must not open reveal.
 */
export function isClassRevealOpen(
  row: { status: string; scheduled_at: string; duration_minutes: number },
  nowMs: number = Date.now(),
): boolean {
  if (row.status !== "completed") return false;
  const endMs = classScheduledEndMs(row.scheduled_at, row.duration_minutes);
  return Number.isFinite(endMs) && nowMs >= endMs;
}
