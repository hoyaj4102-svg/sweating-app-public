import type { Session } from "./session";
import { classScheduledEndMs } from "./reveal";
import { supabaseJson, supabaseServiceJson } from "./supabase";

/** Inclusive grace after scheduled_at + duration_minutes. Matches record_attendance. */
export const ATTENDANCE_GRACE_AFTER_END_MS = 24 * 60 * 60 * 1000;

export const ATTENDANCE_STATUSES = ["attended", "no_show"] as const;

export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

export const ATTENDANCE_WINDOW_NOTE =
  "출석은 수업 시작 시각부터 종료 후 24시간까지, 관장(체육관 호스트) 또는 승인된 관리자만 기록할 수 있습니다.";

const MESSAGES = {
  invalidStatus: "출석 상태는 출석 또는 불참만 기록할 수 있습니다.",
  forbidden: "출석을 기록할 권한이 없습니다.",
  tooEarly: "수업 시작 전에는 출석을 기록할 수 없습니다.",
  closed: "출석 기록은 수업 종료 후 24시간까지만 가능합니다.",
  notFound: "클래스 또는 참가자를 찾을 수 없습니다.",
  classState: "이 수업은 출석을 기록할 수 있는 상태가 아닙니다.",
  participantState: "취소된 참가자의 출석은 기록할 수 없습니다.",
  locked: "이미 관심이 전달된 참가자의 출석은 바꿀 수 없습니다.",
  invalidClass: "수업 일정을 확인할 수 없습니다.",
  generic: "출석을 기록하지 못했습니다.",
  unauthenticated: "로그인이 필요합니다.",
};

type ClassGate = {
  id: string;
  gym_id: string;
  status: string;
  scheduled_at: string;
  duration_minutes: number;
};

export type AttendanceResult = {
  status: number;
  body: { error: string } | Record<string, unknown>;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export function isAttendanceStatus(value: unknown): value is AttendanceStatus {
  return value === "attended" || value === "no_show";
}

/**
 * Open from the scheduled start through 24 hours after the scheduled end.
 * Invalid schedules fail closed.
 */
export function attendanceWindowState(
  scheduledAt: string,
  durationMinutes: number,
  nowMs: number = Date.now(),
): "open" | "before_start" | "closed" | "invalid" {
  const startMs = Date.parse(scheduledAt);
  const endMs = classScheduledEndMs(scheduledAt, durationMinutes);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return "invalid";
  if (nowMs < startMs) return "before_start";
  if (nowMs > endMs + ATTENDANCE_GRACE_AFTER_END_MS) return "closed";
  return "open";
}

/** Gym owner (class host) or is_admin. A plain participant is neither. */
export function mayRecordAttendance(
  actorId: string,
  isAdmin: boolean,
  ownerUserId: string | null,
): boolean {
  if (!actorId) return false;
  if (isAdmin) return true;
  return ownerUserId !== null && ownerUserId === actorId;
}

export function mapAttendanceRpcError(message: string): AttendanceResult {
  if (/attendance_forbidden/i.test(message)) {
    return { status: 403, body: { error: MESSAGES.forbidden } };
  }
  if (/attendance_too_early/i.test(message)) {
    return { status: 409, body: { error: MESSAGES.tooEarly } };
  }
  if (/attendance_window_closed/i.test(message)) {
    return { status: 409, body: { error: MESSAGES.closed } };
  }
  if (/class_not_found|participant_not_found/i.test(message)) {
    return { status: 404, body: { error: MESSAGES.notFound } };
  }
  if (/class_not_recordable/i.test(message)) {
    return { status: 400, body: { error: MESSAGES.classState } };
  }
  if (/participant_not_recordable/i.test(message)) {
    return { status: 400, body: { error: MESSAGES.participantState } };
  }
  if (/attendance_status_invalid/i.test(message)) {
    return { status: 400, body: { error: MESSAGES.invalidStatus } };
  }
  if (/attendance_locked/i.test(message)) {
    return { status: 409, body: { error: MESSAGES.locked } };
  }
  if (/authentication_required/i.test(message)) {
    return { status: 401, body: { error: MESSAGES.unauthenticated } };
  }
  return { status: 400, body: { error: MESSAGES.generic } };
}

function result(status: number, error: string): AttendanceResult {
  return { status, body: { error } };
}

/**
 * API gate, then the SQL function with the caller's JWT.
 * gym_owners is read with the service role because clients cannot see that table.
 * The RPC still re-checks the role, the clock, and the participant.
 */
export async function recordClassAttendance(
  session: Session,
  classId: string,
  userId: string,
  attendanceStatus: unknown,
  nowMs: number = Date.now(),
): Promise<AttendanceResult> {
  if (!isUuid(classId) || !isUuid(userId)) {
    return result(400, MESSAGES.notFound);
  }

  if (!isAttendanceStatus(attendanceStatus)) {
    return result(400, MESSAGES.invalidStatus);
  }

  const profiles = await supabaseJson<Array<{ is_admin?: boolean }>>(
    `/rest/v1/profiles?select=is_admin&id=eq.${encodeURIComponent(session.user.id)}&limit=1`,
    { method: "GET" },
    session.accessToken,
  );
  const isAdmin = profiles[0]?.is_admin === true;

  const classes = await supabaseServiceJson<ClassGate[]>(
    `/rest/v1/classes?select=id,gym_id,status,scheduled_at,duration_minutes&id=eq.${encodeURIComponent(classId)}&limit=1`,
  );
  const selected = classes[0];
  if (!selected) return result(404, MESSAGES.notFound);

  const owners = await supabaseServiceJson<Array<{ user_id: string }>>(
    `/rest/v1/gym_owners?select=user_id&gym_id=eq.${encodeURIComponent(selected.gym_id)}&limit=1`,
  );
  const ownerUserId = owners[0]?.user_id ?? null;

  if (!mayRecordAttendance(session.user.id, isAdmin, ownerUserId)) {
    return result(403, MESSAGES.forbidden);
  }

  if (selected.status !== "published" && selected.status !== "completed") {
    return result(400, MESSAGES.classState);
  }

  const windowState = attendanceWindowState(selected.scheduled_at, selected.duration_minutes, nowMs);
  if (windowState === "before_start") return result(409, MESSAGES.tooEarly);
  if (windowState === "closed") return result(409, MESSAGES.closed);
  if (windowState === "invalid") return result(400, MESSAGES.invalidClass);

  try {
    const raw = await supabaseJson<unknown>(
      "/rest/v1/rpc/record_attendance",
      {
        method: "POST",
        body: JSON.stringify({
          p_class_id: classId,
          p_user_id: userId,
          p_status: attendanceStatus,
        }),
      },
      session.accessToken,
    );
    const row = Array.isArray(raw) ? raw[0] : raw;
    if (!row || typeof row !== "object") return result(404, MESSAGES.notFound);
    return { status: 200, body: row as Record<string, unknown> };
  } catch (error) {
    const message = error instanceof Error ? error.message : MESSAGES.generic;
    return mapAttendanceRpcError(message);
  }
}
