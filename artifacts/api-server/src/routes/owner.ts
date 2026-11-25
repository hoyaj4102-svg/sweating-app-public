import { Router } from "express";
import { CompleteClassResponse } from "@workspace/api-zod";
import { parseAdminClassWrite, parseClassId, parseGymId } from "../lib/admin-input";
import { recordClassAttendance } from "../lib/attendance";
import { getClassDetails, getClassRow, type ClassRow } from "../lib/data";
import {
  GYM_MOVE_ERROR,
  OWNER_CLASS_LOCKED,
  OWNER_CREATE_STATUS_ERROR,
  OWNER_FORBIDDEN,
  requireOwnedClass,
  requireOwnedGym,
  rosterRows,
  listOwnedGymIds,
  withoutPaymentFields,
} from "../lib/owner-access";
import { requireSession } from "../lib/session";
import { supabaseBody, supabaseJson } from "../lib/supabase";

const router = Router();

function pathId(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function denied(error: unknown): boolean {
  const message = error instanceof Error ? error.message : "";
  return /row-level security|owner_required|gym_move_forbidden/i.test(message);
}

router.get("/owner/gyms", async (request, response) => {
  const session = await requireSession(request, response);
  if (!session) return;
  try {
    const ids = await listOwnedGymIds(session);
    if (!ids.length) {
      response.status(403).json({ error: OWNER_FORBIDDEN });
      return;
    }
    const gyms = await supabaseJson<unknown[]>(
      `/rest/v1/gyms?select=*&id=in.(${ids.map((id) => encodeURIComponent(id)).join(",")})&order=created_at.desc`,
      { method: "GET" },
      session.accessToken,
    );
    response.json(gyms);
  } catch {
    response.status(500).json({ error: "체육관 목록을 불러오지 못했습니다." });
  }
});

router.get("/owner/classes", async (request, response) => {
  const session = await requireSession(request, response);
  if (!session) return;
  try {
    const ids = await listOwnedGymIds(session);
    if (!ids.length) {
      response.status(403).json({ error: OWNER_FORBIDDEN });
      return;
    }
    let scope = ids;
    if (typeof request.query.gym_id === "string" && request.query.gym_id) {
      const gymId = parseGymId(request.query.gym_id);
      if (!gymId.ok) {
        response.status(400).json({ error: gymId.error });
        return;
      }
      if (!ids.includes(gymId.value)) {
        response.status(403).json({ error: OWNER_FORBIDDEN });
        return;
      }
      scope = [gymId.value];
    }
    const rows = await supabaseJson<ClassRow[]>(
      `/rest/v1/classes?select=*,gyms(*)&gym_id=in.(${scope.map((id) => encodeURIComponent(id)).join(",")})&order=scheduled_at.desc`,
      { method: "GET" },
      session.accessToken,
    );
    response.json(await getClassDetails(rows, session));
  } catch {
    response.status(500).json({ error: "클래스 목록을 불러오지 못했습니다." });
  }
});

router.post("/owner/classes", async (request, response) => {
  const session = await requireSession(request, response);
  if (!session) return;
  const parsed = parseAdminClassWrite(request.body);
  if (!parsed.ok) {
    response.status(400).json({ error: parsed.error });
    return;
  }
  if (parsed.value.status === "cancelled") {
    response.status(400).json({ error: OWNER_CREATE_STATUS_ERROR });
    return;
  }
  if (!(await requireOwnedGym(session, parsed.value.gym_id, response))) return;
  try {
    const rows = await supabaseJson<unknown[]>(
      "/rest/v1/classes",
      { method: "POST", ...supabaseBody(parsed.value) },
      session.accessToken,
    );
    if (!rows[0]) {
      response.status(403).json({ error: OWNER_FORBIDDEN });
      return;
    }
    response.status(201).json(rows[0]);
  } catch (error) {
    response.status(denied(error) ? 403 : 400).json({
      error: denied(error) ? OWNER_FORBIDDEN : "클래스를 만들지 못했습니다.",
    });
  }
});

router.patch("/owner/classes/:classId", async (request, response) => {
  const session = await requireSession(request, response);
  if (!session) return;
  const classId = parseClassId(pathId(request.params.classId));
  if (!classId.ok) {
    response.status(400).json({ error: classId.error });
    return;
  }
  const existing = await requireOwnedClass(session, classId.value, response);
  if (!existing) return;
  if (existing.status === "completed" || existing.status === "cancelled") {
    response.status(409).json({ error: OWNER_CLASS_LOCKED });
    return;
  }
  const parsed = parseAdminClassWrite(request.body);
  if (!parsed.ok) {
    response.status(400).json({ error: parsed.error });
    return;
  }
  if (parsed.value.gym_id !== existing.gym_id) {
    response.status(400).json({ error: GYM_MOVE_ERROR });
    return;
  }
  try {
    const rows = await supabaseJson<unknown[]>(
      `/rest/v1/classes?id=eq.${encodeURIComponent(classId.value)}`,
      { method: "PATCH", ...supabaseBody({ ...parsed.value, gym_id: existing.gym_id }) },
      session.accessToken,
    );
    if (!rows[0]) {
      response.status(403).json({ error: OWNER_FORBIDDEN });
      return;
    }
    response.json(rows[0]);
  } catch (error) {
    response.status(denied(error) ? 403 : 400).json({
      error: denied(error) ? OWNER_FORBIDDEN : "클래스를 수정하지 못했습니다.",
    });
  }
});

router.get("/owner/classes/:classId/participants", async (request, response) => {
  const session = await requireSession(request, response);
  if (!session) return;
  const classId = parseClassId(pathId(request.params.classId));
  if (!classId.ok) {
    response.status(400).json({ error: classId.error });
    return;
  }
  if (!(await requireOwnedClass(session, classId.value, response))) return;
  try {
    const raw = await supabaseJson<unknown>(
      "/rest/v1/rpc/owner_class_roster",
      { method: "POST", body: JSON.stringify({ p_class_id: classId.value }) },
      session.accessToken,
    );
    response.json(rosterRows(raw));
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/class_not_found/i.test(message)) {
      response.status(404).json({ error: "클래스를 찾을 수 없습니다." });
      return;
    }
    response.status(403).json({ error: OWNER_FORBIDDEN });
  }
});

router.patch("/owner/classes/:classId/participants/:userId/attendance", async (request, response) => {
  const session = await requireSession(request, response);
  if (!session) return;
  const classId = parseClassId(pathId(request.params.classId));
  if (!classId.ok) {
    response.status(400).json({ error: classId.error });
    return;
  }
  const participantId = parseClassId(pathId(request.params.userId));
  if (!participantId.ok) {
    response.status(400).json({ error: participantId.error });
    return;
  }
  if (!(await requireOwnedClass(session, classId.value, response))) return;
  try {
    const result = await recordClassAttendance(
      session,
      classId.value,
      participantId.value,
      request.body?.attendance_status,
    );
    if (result.status === 200) {
      response.status(200).json(withoutPaymentFields(result.body as Record<string, unknown>));
      return;
    }
    response.status(result.status).json(result.body);
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : "출석을 기록하지 못했습니다." });
  }
});

router.patch("/owner/classes/:classId/complete", async (request, response) => {
  const session = await requireSession(request, response);
  if (!session) return;
  const classId = parseClassId(pathId(request.params.classId));
  if (!classId.ok) {
    response.status(400).json({ error: classId.error });
    return;
  }
  if (!(await requireOwnedClass(session, classId.value, response))) return;
  try {
    const rawResult = await supabaseJson<unknown>(
      "/rest/v1/rpc/complete_class",
      { method: "POST", body: JSON.stringify({ p_class_id: classId.value }) },
      session.accessToken,
    );
    const row = Array.isArray(rawResult) ? rawResult[0] : rawResult;
    if (!row || typeof row !== "object") {
      response.status(404).json({ error: "클래스를 찾을 수 없습니다." });
      return;
    }
    const completedRow = await getClassRow(classId.value, session.accessToken);
    if (!completedRow) {
      response.status(404).json({ error: "클래스를 찾을 수 없습니다." });
      return;
    }
    const details = await getClassDetails([completedRow], session);
    response.json(CompleteClassResponse.parse(details[0]));
  } catch (error) {
    const message = error instanceof Error ? error.message : "클래스를 완료 처리하지 못했습니다.";
    if (/class_not_finished/i.test(message)) {
      response.status(409).json({ error: "수업 종료 시각 이후 완료할 수 있습니다." });
      return;
    }
    if (/admin_required|owner_required/i.test(message)) {
      response.status(403).json({ error: OWNER_FORBIDDEN });
      return;
    }
    const status = /class_not_found/i.test(message) ? 404 : 400;
    response.status(status).json({ error: status === 404 ? "클래스를 찾을 수 없습니다." : "클래스를 완료 처리하지 못했습니다." });
  }
});

export default router;
