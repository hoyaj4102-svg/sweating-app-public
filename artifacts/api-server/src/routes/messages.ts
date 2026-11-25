import { Router } from "express";
import {
  ACK_FAILED,
  acknowledgementError,
  acknowledgePrinciples,
  listInbox,
  parsePrinciplesVersion,
} from "../lib/announcements";
import { requireSession } from "../lib/session";

const router = Router();

router.get("/messages", async (request, response) => {
  const session = await requireSession(request, response);
  if (!session) return;
  try {
    response.json({ announcements: await listInbox(session.accessToken) });
  } catch {
    response.status(500).json({ error: "공지를 불러오지 못했습니다." });
  }
});

router.post("/messages/principles/acknowledge", async (request, response) => {
  const session = await requireSession(request, response);
  if (!session) return;
  const parsed = parsePrinciplesVersion(request.body);
  if (!parsed.ok) {
    response.status(400).json({ error: parsed.error });
    return;
  }
  try {
    const acknowledgedAt = await acknowledgePrinciples(session.accessToken, parsed.value);
    response.json({
      notice_version: parsed.value,
      acknowledged_at: acknowledgedAt,
    });
  } catch (error) {
    const mapped = acknowledgementError(error);
    response.status(mapped.status).json({ error: mapped.error || ACK_FAILED });
  }
});

export default router;
