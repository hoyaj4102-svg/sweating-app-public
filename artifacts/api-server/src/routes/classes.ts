import { Router } from "express";
import { GetRevealedParticipantsResponse, LikeParticipantBody, LikeParticipantResponse } from "@workspace/api-zod";
import {
  JOIN_OWN_BAND_ERROR,
  classVisibleToViewer,
  joinBandError,
} from "../lib/age-band";
import {
  CLASS_STARTED_MESSAGE,
  classHasStarted,
  isClassStartedError,
  isUpcomingClass,
  upcomingScheduledAtFilter,
} from "../lib/class-schedule";
import { getClassDetails, getClassRow, getProfile } from "../lib/data";
import { authenticate, requireSession } from "../lib/session";
import { getRevealedParticipants } from "../lib/social";
import { supabaseJson, supabaseServiceJson } from "../lib/supabase";

const router = Router();

async function viewerFor(session: Awaited<ReturnType<typeof authenticate>>) {
  if (!session) return null;
  const profile = await getProfile(session.user.id, session.accessToken);
  return {
    birthYear: profile?.birth_year ?? null,
    agePreference: profile?.age_preference ?? null,
    isAdmin: Boolean(profile?.is_admin),
  };
}

router.get("/classes", async (request, response) => {
  const session = await authenticate(request, response);
  const sport = typeof request.query.sport === "string" ? request.query.sport : null;
  const filters = [
    "select=*,gyms(*)",
    "status=eq.published",
    upcomingScheduledAtFilter(),
    "order=scheduled_at.asc",
  ];
  if (sport && sport !== "전체") filters.push(`sport_type=eq.${encodeURIComponent(sport)}`);
  try {
    const viewer = await viewerFor(session);
    const rows = await supabaseJson<Awaited<ReturnType<typeof getClassRow>>[]>(
      `/rest/v1/classes?${filters.join("&")}`,
      { method: "GET" },
      session?.accessToken,
    );
    const visible = rows
      .filter((row): row is NonNullable<typeof row> => Boolean(row))
      .filter((row) => isUpcomingClass(row.scheduled_at))
      .filter((row) => classVisibleToViewer(row.age_band, viewer));
    response.json(await getClassDetails(visible, session));
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : "클래스를 불러오지 못했습니다." });
  }
});

router.get("/classes/:classId", async (request, response) => {
  const session = await authenticate(request, response);
  try {
    const row = await getClassRow(request.params.classId, session?.accessToken);
    if (!row || row.status !== "published") {
      response.status(404).json({ error: "클래스를 찾을 수 없습니다." });
      return;
    }
    const viewer = await viewerFor(session);
    const details = await getClassDetails([row], session);
    const joined = Boolean(details[0]?.is_joined);
    if (!joined && !classVisibleToViewer(row.age_band, viewer)) {
      response.status(404).json({ error: "클래스를 찾을 수 없습니다." });
      return;
    }
    response.json(details[0]);
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : "클래스를 불러오지 못했습니다." });
  }
});

router.post("/classes/:classId/participants", async (request, response) => {
  const session = await requireSession(request, response);
  if (!session) return;
  try {
    const [profile, row] = await Promise.all([
      getProfile(session.user.id, session.accessToken),
      getClassRow(request.params.classId, session.accessToken),
    ]);
    if (!row || row.status !== "published") {
      response.status(404).json({ error: "클래스를 찾을 수 없습니다." });
      return;
    }
    if (classHasStarted(row.scheduled_at)) {
      response.status(409).json({ error: CLASS_STARTED_MESSAGE });
      return;
    }
    const bandError = joinBandError(row.age_band, {
      birthYear: profile?.birth_year ?? null,
      agePreference: profile?.age_preference ?? null,
      isAdmin: Boolean(profile?.is_admin),
    });
    if (bandError) {
      response.status(403).json({ error: bandError });
      return;
    }
    const result = await supabaseServiceJson<unknown[]>(
      "/rest/v1/rpc/join_class",
      {
        method: "POST",
        body: JSON.stringify({
          p_class_id: request.params.classId,
          p_user_id: session.user.id,
        }),
      },
    );
    const participant = Array.isArray(result) ? result[0] : result;
    response.status(201).json(participant);
  } catch (error) {
    const message = error instanceof Error ? error.message : "참가 신청에 실패했습니다.";
    if (/age_band_mismatch/i.test(message)) {
      response.status(403).json({ error: JOIN_OWN_BAND_ERROR });
      return;
    }
    if (isClassStartedError(message)) {
      response.status(409).json({ error: CLASS_STARTED_MESSAGE });
      return;
    }
    const conflict = /already|full|capacity|중복|정원/i.test(message);
    response.status(conflict ? 409 : 400).json({ error: message });
  }
});

router.delete("/classes/:classId/participants", async (request, response) => {
  const session = await requireSession(request, response);
  if (!session) return;
  try {
    const result = await supabaseServiceJson<unknown>(
      "/rest/v1/rpc/cancel_class_seat",
      {
        method: "POST",
        body: JSON.stringify({
          p_class_id: request.params.classId,
          p_user_id: session.user.id,
        }),
      },
    );
    const participant = Array.isArray(result) ? result[0] : result;
    response.status(200).json(participant);
  } catch (error) {
    const message = error instanceof Error ? error.message : "참가 취소에 실패했습니다.";
    const missing = /not_joined|class_not_found/i.test(message);
    const conflict = /already|full|capacity|seat_not_cancellable|중복|정원/i.test(message);
    response.status(missing ? 404 : conflict ? 409 : 400).json({ error: message });
  }
});

router.get("/classes/:classId/blind", async (request, response) => {
  const session = await requireSession(request, response);
  if (!session) return;
  try {
    const revealed = await getRevealedParticipants(request.params.classId, session.user.id);
    const result = {
      ...revealed,
      participant_count: revealed.class.participant_count,
      participant_slots: Array.from({ length: revealed.class.participant_count }, () => "참가자"),
      is_before_start: !revealed.is_revealed,
    };
    response.json(result);
  } catch (error) {
    const status = error instanceof Error && "status" in error
      ? Number((error as { status?: number }).status)
      : 500;
    response.status(status === 403 || status === 404 ? status : 500).json({
      error: error instanceof Error ? error.message : "Blind Workout 정보를 불러오지 못했습니다.",
    });
  }
});

router.get("/classes/:classId/revealed-participants", async (request, response) => {
  const session = await requireSession(request, response);
  if (!session) return;
  try {
    const result = await getRevealedParticipants(request.params.classId, session.user.id);
    response.json(GetRevealedParticipantsResponse.parse(result));
  } catch (error) {
    const status = error instanceof Error && "status" in error
      ? Number((error as { status?: number }).status)
      : 500;
    response.status(status === 403 || status === 404 ? status : 500).json({
      error: error instanceof Error ? error.message : "참가자 정보를 불러오지 못했습니다.",
    });
  }
});

router.post("/classes/:classId/likes", async (request, response) => {
  const session = await requireSession(request, response);
  if (!session) return;
  const parsed = LikeParticipantBody.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: parsed.error.message });
    return;
  }

  try {
    const targetRows = await supabaseServiceJson<Array<{ user_id: string }>>(
      `/rest/v1/class_participants?select=user_id&class_id=eq.${encodeURIComponent(request.params.classId)}&id=eq.${encodeURIComponent(parsed.data.participant_id)}&limit=1`,
    );
    const target = targetRows[0];
    if (!target) {
      response.status(403).json({ error: "같은 클래스의 참가자만 선택할 수 있습니다." });
      return;
    }

    const rawResult = await supabaseJson<unknown[]>(
      "/rest/v1/rpc/like_participant",
      {
        method: "POST",
        body: JSON.stringify({
          p_class_id: request.params.classId,
          p_to_user_id: target.user_id,
        }),
      },
      session.accessToken,
    );
    const result = Array.isArray(rawResult) ? rawResult[0] : rawResult;
    response.json(LikeParticipantResponse.parse(result));
  } catch (error) {
    const message = error instanceof Error ? error.message : "마음을 표현하지 못했습니다.";
    const forbidden = /authentication_required|self_like_not_allowed|class_not_completed|participants_only/i.test(message);
    response.status(forbidden ? 403 : 400).json({ error: message });
  }
});

export default router;