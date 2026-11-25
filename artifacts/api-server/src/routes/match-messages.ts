import { Router } from "express";
import { requireSession } from "../lib/session";
import {
  MATCH_BLOCK_FAILED,
  MATCH_MESSAGES_FAILED,
  MATCH_MESSAGE_SEND_FAILED,
  MATCH_NOT_FOUND,
  MATCH_REPORT_FAILED,
  blockMatchChat,
  getMatchChatStatus,
  isMatchId,
  listMatchMessages,
  matchChatError,
  parseBefore,
  parseMatchMessageWrite,
  parseMatchReportWrite,
  reportMatchChat,
  sendMatchMessage,
  unblockMatchChat,
} from "../lib/match-messages";

const router = Router();

router.get("/matches/:matchId/messages", async (request, response) => {
  const session = await requireSession(request, response);
  if (!session) return;
  const matchId = request.params.matchId;
  if (!isMatchId(matchId)) {
    response.status(404).json({ error: MATCH_NOT_FOUND });
    return;
  }
  const before = parseBefore(request.query.before);
  if (!before.ok) {
    response.status(400).json({ error: "before 값을 확인해 주세요." });
    return;
  }
  try {
    const [messages, block] = await Promise.all([
      listMatchMessages(session.accessToken, session.user.id, matchId, before.value),
      getMatchChatStatus(session.accessToken, session.user.id, matchId),
    ]);
    response.set("Cache-Control", "no-store");
    response.json({ messages, block });
  } catch (error) {
    const mapped = matchChatError(error, MATCH_MESSAGES_FAILED);
    response.status(mapped.status).json({ error: mapped.error });
  }
});

router.post("/matches/:matchId/messages", async (request, response) => {
  const session = await requireSession(request, response);
  if (!session) return;
  const matchId = request.params.matchId;
  if (!isMatchId(matchId)) {
    response.status(404).json({ error: MATCH_NOT_FOUND });
    return;
  }
  const parsed = parseMatchMessageWrite(request.body);
  if (!parsed.ok) {
    response.status(400).json({ error: parsed.error });
    return;
  }
  try {
    const message = await sendMatchMessage(session.accessToken, session.user.id, matchId, parsed.value);
    response.set("Cache-Control", "no-store");
    response.status(201).json({ message });
  } catch (error) {
    const mapped = matchChatError(error, MATCH_MESSAGE_SEND_FAILED);
    response.status(mapped.status).json({ error: mapped.error });
  }
});

router.post("/matches/:matchId/block", async (request, response) => {
  const session = await requireSession(request, response);
  if (!session) return;
  const matchId = request.params.matchId;
  if (!isMatchId(matchId)) {
    response.status(404).json({ error: MATCH_NOT_FOUND });
    return;
  }
  try {
    const block = await blockMatchChat(session.accessToken, session.user.id, matchId);
    response.set("Cache-Control", "no-store");
    response.json({ block });
  } catch (error) {
    const mapped = matchChatError(error, MATCH_BLOCK_FAILED);
    response.status(mapped.status).json({ error: mapped.error });
  }
});

router.delete("/matches/:matchId/block", async (request, response) => {
  const session = await requireSession(request, response);
  if (!session) return;
  const matchId = request.params.matchId;
  if (!isMatchId(matchId)) {
    response.status(404).json({ error: MATCH_NOT_FOUND });
    return;
  }
  try {
    const block = await unblockMatchChat(session.accessToken, session.user.id, matchId);
    response.set("Cache-Control", "no-store");
    response.json({ block });
  } catch (error) {
    const mapped = matchChatError(error, MATCH_BLOCK_FAILED);
    response.status(mapped.status).json({ error: mapped.error });
  }
});

router.post("/matches/:matchId/reports", async (request, response) => {
  const session = await requireSession(request, response);
  if (!session) return;
  const matchId = request.params.matchId;
  if (!isMatchId(matchId)) {
    response.status(404).json({ error: MATCH_NOT_FOUND });
    return;
  }
  const parsed = parseMatchReportWrite(request.body);
  if (!parsed.ok) {
    response.status(400).json({ error: parsed.error });
    return;
  }
  try {
    const report = await reportMatchChat(session.accessToken, session.user.id, matchId, parsed.value);
    response.set("Cache-Control", "no-store");
    response.status(201).json({ report });
  } catch (error) {
    const mapped = matchChatError(error, MATCH_REPORT_FAILED);
    response.status(mapped.status).json({ error: mapped.error });
  }
});

export default router;
