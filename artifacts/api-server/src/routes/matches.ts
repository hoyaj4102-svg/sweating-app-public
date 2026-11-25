import { Router } from "express";
import { GetMatchParams, GetMatchResponse, ListMatchesResponse } from "@workspace/api-zod";
import { requireSession } from "../lib/session";
import { getMatchForUser, listMatchesForUser } from "../lib/social";

const router = Router();

router.get("/matches", async (request, response) => {
  const session = await requireSession(request, response);
  if (!session) return;
  try {
    response.json(ListMatchesResponse.parse(await listMatchesForUser(session.user.id)));
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : "매치 목록을 불러오지 못했습니다.",
    });
  }
});

router.get("/matches/:matchId", async (request, response) => {
  const session = await requireSession(request, response);
  if (!session) return;
  const parsed = GetMatchParams.safeParse(request.params);
  if (!parsed.success) {
    response.status(400).json({ error: parsed.error.message });
    return;
  }

  try {
    const match = await getMatchForUser(parsed.data.matchId, session.user.id);
    if (!match) {
      response.status(404).json({ error: "매치를 찾을 수 없습니다." });
      return;
    }
    response.json(GetMatchResponse.parse(match));
  } catch (error) {
    const status = error instanceof Error && "status" in error
      ? Number((error as { status?: number }).status)
      : 500;
    response.status(status === 403 ? 403 : 500).json({
      error: error instanceof Error ? error.message : "매치를 불러오지 못했습니다.",
    });
  }
});

export default router;