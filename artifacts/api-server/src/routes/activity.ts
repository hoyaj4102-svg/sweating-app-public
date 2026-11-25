import { Router } from "express";
import { getClassDetails } from "../lib/data";
import { requireSession } from "../lib/session";
import { supabaseJson } from "../lib/supabase";

const router = Router();

router.get("/activity", async (request, response) => {
  const session = await requireSession(request, response);
  if (!session) return;
  try {
    const participation = await supabaseJson<Array<{ class_id: string }>>(
      `/rest/v1/class_participants?select=class_id&user_id=eq.${encodeURIComponent(session.user.id)}&attendance_status=neq.cancelled&order=joined_at.desc`,
      { method: "GET" },
      session.accessToken,
    );
    const ids = [...new Set(participation.map((item) => item.class_id))];
    if (!ids.length) {
      response.json({ upcoming: [], completed: [] });
      return;
    }
    const rows = await supabaseJson<Parameters<typeof getClassDetails>[0]>(
      `/rest/v1/classes?select=*,gyms(*)&id=in.(${encodeURIComponent(ids.join(","))})&order=scheduled_at.asc`,
      { method: "GET" },
      session.accessToken,
    );
    const details = await getClassDetails(rows, session);
    const now = Date.now();
    response.json({
      upcoming: details.filter((item) => item.status !== "completed" && new Date(item.scheduled_at).getTime() >= now),
      completed: details.filter((item) => item.status === "completed"),
    });
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : "활동을 불러오지 못했습니다." });
  }
});

export default router;