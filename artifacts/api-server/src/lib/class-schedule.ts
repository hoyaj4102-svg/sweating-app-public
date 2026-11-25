/**
 * Class start checks must match join_class, which raises class_started when
 * scheduled_at <= now(). scheduled_at is timestamptz, so compare UTC instants.
 * Do not compare KST calendar strings against a UTC clock.
 */
export const CLASS_STARTED_CODE = "class_started";
export const CLASS_STARTED_MESSAGE = "모집이 마감된 클래스입니다.";

export function classStartMs(scheduledAt: string | Date): number {
  return scheduledAt instanceof Date ? scheduledAt.getTime() : Date.parse(scheduledAt);
}

export function classHasStarted(scheduledAt: string | Date, nowMs = Date.now()): boolean {
  const startMs = classStartMs(scheduledAt);
  if (Number.isNaN(startMs)) return true;
  return startMs <= nowMs;
}

export function isUpcomingClass(scheduledAt: string | Date, nowMs = Date.now()): boolean {
  return !classHasStarted(scheduledAt, nowMs);
}

export function upcomingScheduledAtFilter(nowMs = Date.now()): string {
  return `scheduled_at=gt.${encodeURIComponent(new Date(nowMs).toISOString())}`;
}

export function isClassStartedError(message: string): boolean {
  return /class_started/i.test(message);
}
