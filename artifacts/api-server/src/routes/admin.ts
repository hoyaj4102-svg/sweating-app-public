import { Router } from "express";
import { CompleteClassResponse } from "@workspace/api-zod";
import { recordClassAttendance } from "../lib/attendance";
import {
  parseAdminClassWrite,
  parseAdminGymWrite,
  parseClassId,
  parseGymId,
  parseParticipantClassId,
  parseUpdateClassId,
} from "../lib/admin-input";
import { getClassDetails, getClassRow, getParticipantRows, requireAdmin } from "../lib/data";
import {
  ACCOUNT_NOT_FOUND,
  OWNER_EMAIL_ERROR,
  OWNER_EXISTS,
  OWNER_GYM_MISSING,
  lookupUserIdByEmail,
  parseOwnerEmail,
  readGymOwner,
} from "../lib/owner-access";
import { displayProfilePhoto } from "../lib/profile-photo-storage";
import { requireSession } from "../lib/session";
import {
  NOTICE_FAILED,
  listOwnerNotices,
  parseOwnerNoticeWrite,
  publishOwnerNotice,
} from "../lib/announcements";
import { listAdminMatchReports } from "../lib/match-messages";
import { supabaseBody, supabaseJson, supabaseServiceJson } from "../lib/supabase";

const router = Router();

async function adminSession(request: Parameters<typeof requireSession>[0], response: Parameters<typeof requireSession>[1]) {
  const session = await requireSession(request, response);
  if (!session) return null;
  const profile = await requireAdmin(session, response);
  return profile ? session : null;
}

function pathId(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

router.get("/admin/gyms", async (request, response) => {
  const session = await adminSession(request, response);
  if (!session) return;
  const rows = await supabaseJson<unknown[]>("/rest/v1/gyms?select=*&order=created_at.desc", { method: "GET" }, session.accessToken);
  response.json(rows);
});

router.post("/admin/gyms", async (request, response) => {
  const session = await adminSession(request, response);
  if (!session) return;
  const parsed = parseAdminGymWrite(request.body);
  if (!parsed.ok) {
    response.status(400).json({ error: parsed.error });
    return;
  }
  try {
    const rows = await supabaseJson<unknown[]>("/rest/v1/gyms", { method: "POST", ...supabaseBody(parsed.value) }, session.accessToken);
    response.status(201).json(rows[0]);
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : "체육관을 만들지 못했습니다." });
  }
});

router.patch("/admin/gyms/:gymId", async (request, response) => {
  const session = await adminSession(request, response);
  if (!session) return;
  const gymId = parseGymId(pathId(request.params.gymId));
  if (!gymId.ok) {
    response.status(400).json({ error: gymId.error });
    return;
  }
  const parsed = parseAdminGymWrite(request.body);
  if (!parsed.ok) {
    response.status(400).json({ error: parsed.error });
    return;
  }
  try {
    const rows = await supabaseJson<unknown[]>(
      `/rest/v1/gyms?id=eq.${encodeURIComponent(gymId.value)}`,
      { method: "PATCH", ...supabaseBody(parsed.value) },
      session.accessToken,
    );
    response.json(rows[0]);
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : "체육관을 수정하지 못했습니다." });
  }
});

async function adminGymExists(gymId: string, accessToken: string): Promise<boolean> {
  const rows = await supabaseJson<Array<{ id: string }>>(
    `/rest/v1/gyms?select=id&id=eq.${encodeURIComponent(gymId)}&limit=1`,
    { method: "GET" },
    accessToken,
  );
  return Boolean(rows[0]);
}

router.get("/admin/gyms/:gymId/owner", async (request, response) => {
  const session = await adminSession(request, response);
  if (!session) return;
  const gymId = parseGymId(pathId(request.params.gymId));
  if (!gymId.ok) {
    response.status(400).json({ error: gymId.error });
    return;
  }
  if (!(await adminGymExists(gymId.value, session.accessToken))) {
    response.status(404).json({ error: OWNER_GYM_MISSING });
    return;
  }
  response.json({ owner: await readGymOwner(gymId.value) });
});

router.post("/admin/gyms/:gymId/owner", async (request, response) => {
  const session = await adminSession(request, response);
  if (!session) return;
  const gymId = parseGymId(pathId(request.params.gymId));
  if (!gymId.ok) {
    response.status(400).json({ error: gymId.error });
    return;
  }
  const email = parseOwnerEmail(request.body);
  if (!email.ok) {
    response.status(400).json({ error: email.error || OWNER_EMAIL_ERROR });
    return;
  }
  if (!(await adminGymExists(gymId.value, session.accessToken))) {
    response.status(404).json({ error: OWNER_GYM_MISSING });
    return;
  }
  const current = await readGymOwner(gymId.value);
  if (current) {
    response.status(409).json({ error: OWNER_EXISTS });
    return;
  }
  const userId = await lookupUserIdByEmail(email.value);
  if (!userId) {
    response.status(404).json({ error: ACCOUNT_NOT_FOUND });
    return;
  }
  try {
    await supabaseServiceJson<unknown[]>(
      "/rest/v1/gym_owners",
      {
        method: "POST",
        ...supabaseBody({
          gym_id: gymId.value,
          user_id: userId,
          approved_at: new Date().toISOString(),
        }),
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    response.status(/duplicate|23505/i.test(message) ? 409 : 400).json({
      error: /duplicate|23505/i.test(message) ? OWNER_EXISTS : "관장을 지정하지 못했습니다.",
    });
    return;
  }
  const owner = await readGymOwner(gymId.value);
  response.status(201).json({ owner });
});

router.delete("/admin/gyms/:gymId/owner", async (request, response) => {
  const session = await adminSession(request, response);
  if (!session) return;
  const gymId = parseGymId(pathId(request.params.gymId));
  if (!gymId.ok) {
    response.status(400).json({ error: gymId.error });
    return;
  }
  if (!(await adminGymExists(gymId.value, session.accessToken))) {
    response.status(404).json({ error: OWNER_GYM_MISSING });
    return;
  }
  const current = await readGymOwner(gymId.value);
  if (!current) {
    response.status(404).json({ error: "지정된 관장이 없습니다." });
    return;
  }
  await supabaseServiceJson<unknown[]>(
    `/rest/v1/gym_owners?gym_id=eq.${encodeURIComponent(gymId.value)}`,
    { method: "DELETE", headers: { Prefer: "return=representation" } },
  );
  response.status(204).end();
});

router.get("/admin/announcements", async (request, response) => {
  const session = await adminSession(request, response);
  if (!session) return;
  try {
    response.json({ announcements: await listOwnerNotices() });
  } catch {
    response.status(500).json({ error: "관장 공지를 불러오지 못했습니다." });
  }
});

router.post("/admin/announcements", async (request, response) => {
  const session = await adminSession(request, response);
  if (!session) return;
  const parsed = parseOwnerNoticeWrite(request.body);
  if (!parsed.ok) {
    response.status(400).json({ error: parsed.error });
    return;
  }
  try {
    const published = await publishOwnerNotice(session, parsed.value);
    response.status(201).json({ announcement: published });
  } catch {
    response.status(400).json({ error: NOTICE_FAILED });
  }
});

router.get("/admin/classes", async (request, response) => {
  const session = await adminSession(request, response);
  if (!session) return;
  const rows = await supabaseJson<Parameters<typeof getClassDetails>[0]>(
    "/rest/v1/classes?select=*,gyms(*)&order=scheduled_at.desc",
    { method: "GET" },
    session.accessToken,
  );
  response.json(await getClassDetails(rows, session));
});

router.post("/admin/classes", async (request, response) => {
  const session = await adminSession(request, response);
  if (!session) return;
  const parsed = parseAdminClassWrite(request.body);
  if (!parsed.ok) {
    response.status(400).json({ error: parsed.error });
    return;
  }
  try {
    const rows = await supabaseServiceJson<unknown[]>("/rest/v1/classes", { method: "POST", ...supabaseBody(parsed.value) });
    response.status(201).json(rows[0]);
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : "클래스를 만들지 못했습니다." });
  }
});

router.patch("/admin/classes/:classId/complete", async (request, response) => {
  const session = await adminSession(request, response);
  if (!session) return;
  const classId = parseClassId(pathId(request.params.classId));
  if (!classId.ok) {
    response.status(400).json({ error: classId.error });
    return;
  }
  try {
    const rawResult = await supabaseJson<unknown[]>(
      "/rest/v1/rpc/complete_class",
      {
        method: "POST",
        body: JSON.stringify({ p_class_id: classId.value }),
      },
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
    const status = /admin_required/i.test(message) ? 403 : /class_not_found/i.test(message) ? 404 : 400;
    response.status(status).json({ error: message });
  }
});

router.patch("/admin/classes/:classId", async (request, response) => {
  const session = await adminSession(request, response);
  if (!session) return;
  const classId = parseUpdateClassId(pathId(request.params.classId));
  if (!classId.ok) {
    response.status(400).json({ error: classId.error });
    return;
  }
  const parsed = parseAdminClassWrite(request.body);
  if (!parsed.ok) {
    response.status(400).json({ error: parsed.error });
    return;
  }
  try {
    const rows = await supabaseServiceJson<unknown[]>(
      `/rest/v1/classes?id=eq.${encodeURIComponent(classId.value)}`,
      { method: "PATCH", ...supabaseBody(parsed.value) },
    );
    response.json(rows[0]);
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : "클래스를 수정하지 못했습니다." });
  }
});

router.get("/admin/classes/:classId/participants", async (request, response) => {
  const session = await adminSession(request, response);
  if (!session) return;
  const classId = parseParticipantClassId(pathId(request.params.classId));
  if (!classId.ok) {
    response.status(400).json({ error: classId.error });
    return;
  }
  try {
    const rows = await getParticipantRows(classId.value, session.accessToken);
    response.json(await Promise.all(rows.map(async (row) => {
      if (!row.profiles) return row;
      return {
        ...row,
        profiles: {
          ...row.profiles,
          profile_photo_url: await displayProfilePhoto(row.profiles.profile_photo_url, row.user_id),
        },
      };
    })));
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : "참가자 목록을 불러오지 못했습니다." });
  }
});

// Gym owners are not necessarily is_admin. The SQL function is the authority;
// recordClassAttendance applies the same owner-or-admin and clock checks first.
router.patch("/admin/classes/:classId/participants/:userId/attendance", async (request, response) => {
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
  try {
    const result = await recordClassAttendance(
      session,
      classId.value,
      participantId.value,
      request.body?.attendance_status,
    );
    response.status(result.status).json(result.body);
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : "출석을 기록하지 못했습니다." });
  }
});

router.get("/admin/match-reports", async (request, response) => {
  const session = await adminSession(request, response);
  if (!session) return;
  try {
    const reports = await listAdminMatchReports(session.accessToken);
    response.set("Cache-Control", "no-store");
    response.json({ reports });
  } catch {
    response.status(500).json({ error: "신고 목록을 불러오지 못했습니다." });
  }
});

export default router;
