import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import {
  MATCH_MESSAGE_MAX_LENGTH,
  MATCH_REPORT_DETAIL_MAX_LENGTH,
  MATCH_REPORT_OPTIONS,
  appendMessage,
  canSendMessage,
  canSubmitReportDetail,
  errorFromResponse,
  formatMessageTime,
  messageLength,
  readBlockStatus,
  readMatchMessages,
  readSentMessage,
  type MatchChatBlockStatus,
  type MatchChatMessage,
  type MatchReportReason,
} from "./match-chat";

const POLL_MS = 15_000;

type MatchHeader = { name: string; classTitle: string };

function readHeader(payload: unknown): MatchHeader | null {
  if (!payload || typeof payload !== "object") return null;
  const row = payload as { class_title?: unknown; participant?: { display_name?: unknown } };
  const name = typeof row.participant?.display_name === "string" ? row.participant.display_name : "";
  const classTitle = typeof row.class_title === "string" ? row.class_title : "";
  return { name, classTitle };
}

export function MatchChatPage({ matchId, pollMs = POLL_MS }: { matchId: string; pollMs?: number }) {
  const [header, setHeader] = useState<MatchHeader | null>(null);
  const [messages, setMessages] = useState<MatchChatMessage[] | null>(null);
  const [block, setBlock] = useState<MatchChatBlockStatus>({ is_blocked: false, blocked_by_me: false });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [closed, setClosed] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [confirmingBlock, setConfirmingBlock] = useState(false);
  const [blockBusy, setBlockBusy] = useState(false);
  const [reportTargetId, setReportTargetId] = useState<string | null | undefined>(undefined);
  const [reportReason, setReportReason] = useState<MatchReportReason>(MATCH_REPORT_OPTIONS[0].value);
  const [reportDetail, setReportDetail] = useState("");
  const [reportBusy, setReportBusy] = useState(false);
  const listRef = useRef<HTMLOListElement | null>(null);
  const encoded = encodeURIComponent(matchId);

  const load = useCallback(async (signal?: AbortSignal) => {
    const result = await fetch(`/api/matches/${encoded}/messages`, { credentials: "include", signal });
    if (signal?.aborted) return;
    if (!result.ok) {
      if (result.status === 403 || result.status === 404) setClosed(true);
      setError(await errorFromResponse(result, "메시지를 불러오지 못했습니다."));
      return;
    }
    const payload = await result.json();
    setClosed(false);
    setError("");
    setMessages(readMatchMessages(payload));
    const nextBlock = readBlockStatus(payload);
    if (nextBlock) setBlock(nextBlock);
  }, [encoded]);

  useEffect(() => {
    setHeader(null);
    setMessages(null);
    setBlock({ is_blocked: false, blocked_by_me: false });
    setClosed(false);
    setError("");
    setNotice("");
    setConfirmingBlock(false);
    setReportTargetId(undefined);
    const controller = new AbortController();
    void fetch(`/api/matches/${encoded}`, { credentials: "include", signal: controller.signal })
      .then(async (result) => (result.ok ? readHeader(await result.json()) : null))
      .then((value) => { if (!controller.signal.aborted && value) setHeader(value); })
      .catch(() => undefined);
    void load(controller.signal).catch((err: unknown) => {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "메시지를 불러오지 못했습니다.");
    });
    const timer = pollMs > 0
      ? setInterval(() => {
          if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
          void load(controller.signal).catch(() => undefined);
        }, pollMs)
      : null;
    return () => {
      controller.abort();
      if (timer) clearInterval(timer);
    };
  }, [encoded, load, pollMs]);

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages]);

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSendMessage(draft) || sending || closed || block.is_blocked) return;
    setSending(true);
    setError("");
    setNotice("");
    try {
      const result = await fetch(`/api/matches/${encoded}/messages`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: draft.trim() }),
      });
      if (!result.ok) {
        const message = await errorFromResponse(result, "메시지를 보내지 못했습니다.");
        setError(message);
        if (result.status === 403 || result.status === 404) {
          void load().catch(() => setClosed(true));
        }
        return;
      }
      const sent = readSentMessage(await result.json());
      if (sent) setMessages((rows) => appendMessage(rows ?? [], sent));
      setDraft("");
    } catch {
      setError("메시지를 보내지 못했습니다.");
    } finally {
      setSending(false);
    }
  };

  const toggleBlock = async (shouldBlock: boolean) => {
    if (blockBusy || closed) return;
    setBlockBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await fetch(`/api/matches/${encoded}/block`, {
        method: shouldBlock ? "POST" : "DELETE",
        credentials: "include",
      });
      if (!result.ok) {
        setError(await errorFromResponse(result, "차단 상태를 변경하지 못했습니다."));
        return;
      }
      const nextBlock = readBlockStatus(await result.json());
      if (nextBlock) setBlock(nextBlock);
      setConfirmingBlock(false);
      setNotice(shouldBlock ? "상대방을 차단했습니다." : "차단을 해제했습니다.");
    } catch {
      setError("차단 상태를 변경하지 못했습니다.");
    } finally {
      setBlockBusy(false);
    }
  };

  const submitReport = async (event: React.FormEvent) => {
    event.preventDefault();
    if (reportTargetId === undefined || reportBusy || closed || !canSubmitReportDetail(reportDetail)) return;
    setReportBusy(true);
    setError("");
    setNotice("");
    try {
      const detail = reportDetail.trim();
      const result = await fetch(`/api/matches/${encoded}/reports`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reason: reportReason,
          ...(detail ? { detail } : {}),
          ...(reportTargetId ? { message_id: reportTargetId } : {}),
        }),
      });
      if (!result.ok) {
        setError(await errorFromResponse(result, "신고를 접수하지 못했습니다."));
        return;
      }
      setReportTargetId(undefined);
      setReportDetail("");
      setNotice("신고가 접수됐어요. 운영팀이 확인합니다.");
    } catch {
      setError("신고를 접수하지 못했습니다.");
    } finally {
      setReportBusy(false);
    }
  };

  const length = messageLength(draft);
  const detailLength = messageLength(reportDetail);
  const title = header?.name ? `${header.name}님과의 대화` : "1:1 대화";

  return (
    <section className="match-chat-page wrap activity-page" data-testid="page-match-chat">
      <div className="page-heading">
        <p className="eyebrow">MATCH CHAT</p>
        <h1 data-testid="text-chat-title">{title}</h1>
        {header?.classTitle && <p>{header.classTitle}에서 서로 매치됐어요.</p>}
        <div className="match-chat-actions">
          <Link href="/matches" className="text-link" data-testid="link-back-matches">매치 목록으로</Link>
          {!closed && (
            <div className="match-chat-safety-buttons">
              {block.is_blocked ? (
                block.blocked_by_me ? (
                  <button
                    type="button"
                    className="match-chat-safety-btn"
                    disabled={blockBusy}
                    onClick={() => void toggleBlock(false)}
                    data-testid="button-chat-unblock"
                  >
                    {blockBusy ? "처리 중" : "차단 해제"}
                  </button>
                ) : null
              ) : (
                <button
                  type="button"
                  className="match-chat-safety-btn"
                  disabled={blockBusy}
                  onClick={() => setConfirmingBlock((open) => !open)}
                  data-testid="button-chat-block"
                >
                  차단하기
                </button>
              )}
              <button
                type="button"
                className="match-chat-safety-btn"
                onClick={() => setReportTargetId(null)}
                data-testid="button-chat-report"
              >
                대화 신고
              </button>
            </div>
          )}
        </div>
      </div>

      {confirmingBlock && !block.is_blocked && !closed && (
        <div className="match-chat-safety-panel" data-testid="confirm-chat-block">
          <p>차단하면 두 사람 모두 새 메시지를 보낼 수 없어요. 언제든 차단 해제를 누르면 다시 대화할 수 있습니다.</p>
          <div className="match-chat-safety-buttons">
            <button
              type="button"
              className="match-chat-safety-btn is-danger"
              disabled={blockBusy}
              onClick={() => void toggleBlock(true)}
              data-testid="button-chat-block-confirm"
            >
              {blockBusy ? "처리 중" : "차단 확인"}
            </button>
            <button
              type="button"
              className="match-chat-safety-btn"
              disabled={blockBusy}
              onClick={() => setConfirmingBlock(false)}
              data-testid="button-chat-block-cancel"
            >
              취소
            </button>
          </div>
        </div>
      )}

      {reportTargetId !== undefined && !closed && (
        <form className="match-chat-safety-panel" onSubmit={(event) => void submitReport(event)} data-testid="form-chat-report">
          <h2>{reportTargetId ? "이 메시지 신고하기" : "대화 신고하기"}</h2>
          <p className="match-chat-safety-hint">신고 내용은 운영팀만 확인하며 상대방에게는 공개되지 않습니다.</p>
          <label htmlFor="match-report-reason" className="match-chat-field-label">신고 사유</label>
          <select
            id="match-report-reason"
            value={reportReason}
            onChange={(event) => setReportReason(event.target.value as MatchReportReason)}
            data-testid="select-report-reason"
          >
            {MATCH_REPORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <label htmlFor="match-report-detail" className="match-chat-field-label">상세 내용 (선택)</label>
          <textarea
            id="match-report-detail"
            rows={2}
            value={reportDetail}
            maxLength={MATCH_REPORT_DETAIL_MAX_LENGTH * 2}
            placeholder="필요한 경우 상황을 짧게 적어 주세요 (최대 500자)"
            onChange={(event) => setReportDetail(event.target.value)}
            data-testid="input-report-detail"
          />
          <div className="match-chat-form-row">
            <span className={detailLength > MATCH_REPORT_DETAIL_MAX_LENGTH ? "match-chat-count is-over" : "match-chat-count"} data-testid="text-report-count">
              {detailLength}/{MATCH_REPORT_DETAIL_MAX_LENGTH}
            </span>
            <div className="match-chat-safety-buttons">
              <button
                type="button"
                className="match-chat-safety-btn"
                disabled={reportBusy}
                onClick={() => setReportTargetId(undefined)}
                data-testid="button-report-cancel"
              >
                닫기
              </button>
              <button
                type="submit"
                className="match-chat-safety-btn is-danger"
                disabled={reportBusy || !canSubmitReportDetail(reportDetail)}
                data-testid="button-report-submit"
              >
                {reportBusy ? "접수 중" : "신고 접수"}
              </button>
            </div>
          </div>
        </form>
      )}

      {notice && <p className="match-chat-notice" role="status" data-testid="text-chat-notice">{notice}</p>}
      {error && <p className="form-error" role="alert" data-testid="text-chat-error">{error}</p>}
      {messages && messages.length === 0 && !error && (
        <p className="activity-empty" data-testid="text-chat-empty">아직 메시지가 없어요. 먼저 인사를 건네 보세요.</p>
      )}
      <ol className="match-chat-list" ref={listRef} data-testid="list-chat-messages" aria-live="polite">
        {(messages ?? []).map((message) => (
          <li
            key={message.id}
            className={message.is_mine ? "match-chat-bubble is-mine" : "match-chat-bubble"}
            data-testid={`chat-message-${message.id}`}
          >
            <p>{message.body}</p>
            <div className="match-chat-bubble-meta">
              <time dateTime={message.created_at}>{formatMessageTime(message.created_at)}</time>
              {!message.is_mine && !closed && (
                <button
                  type="button"
                  className="match-chat-msg-report"
                  onClick={() => setReportTargetId(message.id)}
                  data-testid={`button-report-message-${message.id}`}
                >
                  신고
                </button>
              )}
            </div>
          </li>
        ))}
      </ol>
      {closed ? (
        <p className="activity-empty" data-testid="text-chat-closed">이 대화는 열 수 없어요.</p>
      ) : block.is_blocked ? (
        <p className="activity-empty" data-testid="text-chat-blocked">
          {block.blocked_by_me ? "상대방을 차단해 새 메시지를 보낼 수 없어요." : "대화가 차단되어 새 메시지를 보낼 수 없어요."}
        </p>
      ) : (
        <form className="match-chat-form" onSubmit={(event) => void send(event)} data-testid="form-chat">
          <label htmlFor="match-chat-input" className="match-chat-label">메시지</label>
          <textarea
            id="match-chat-input"
            data-testid="input-chat-message"
            value={draft}
            maxLength={MATCH_MESSAGE_MAX_LENGTH * 2}
            rows={2}
            placeholder="메시지를 입력해 주세요"
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className="match-chat-form-row">
            <span className={length > MATCH_MESSAGE_MAX_LENGTH ? "match-chat-count is-over" : "match-chat-count"} data-testid="text-chat-count">
              {length}/{MATCH_MESSAGE_MAX_LENGTH}
            </span>
            <button type="submit" className="button button-primary" disabled={!canSendMessage(draft) || sending} data-testid="button-chat-send">
              {sending ? "보내는 중" : "보내기"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
