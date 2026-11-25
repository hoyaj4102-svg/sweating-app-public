import React, { useEffect, useState } from "react";
import { Link } from "wouter";
import { formatAcknowledgedAt, noticeParagraphs, readInbox, type InboxAnnouncement } from "./inbox";

export function MessagesPage() {
  const [rows, setRows] = useState<InboxAnnouncement[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/messages", { credentials: "include", signal: controller.signal })
      .then(async (result) => {
        if (!result.ok) throw new Error("공지를 불러오지 못했습니다.");
        return result.json() as Promise<unknown>;
      })
      .then((payload) => {
        if (!controller.signal.aborted) setRows(readInbox(payload));
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "공지를 불러오지 못했습니다.");
      });
    return () => controller.abort();
  }, []);

  const pinned = rows?.find((row) => row.kind === "principles" && row.is_current) ?? null;
  const rest = rows?.filter((row) => row !== pinned) ?? [];

  return (
    <section className="messages-page wrap activity-page" data-testid="page-messages">
      <div className="page-heading">
        <p className="eyebrow">MESSAGES</p>
        <h1>메시지</h1>
      </div>
      <section aria-labelledby="notices-heading" data-testid="section-notices">
        <h2 id="notices-heading">공지사항</h2>
        {error && <p className="form-error" role="alert">{error}</p>}
        {rows && rows.length === 0 && !error && <p className="activity-empty">표시할 공지가 없습니다.</p>}
        {pinned && (
          <article className="notice-card notice-pinned" data-testid="notice-principles">
            <p className="eyebrow">고정</p>
            <h3>{pinned.title}</h3>
            {noticeParagraphs(pinned.body).map((paragraph, index) => <p key={index}>{paragraph}</p>)}
            <p data-testid="text-principles-ack">{pinned.acknowledged_at ? formatAcknowledgedAt(pinned.acknowledged_at) : "아직 확인하지 않았습니다."}</p>
          </article>
        )}
        {rest.map((row) => (
          <article className="notice-card" key={row.notice_version} data-testid={`notice-${row.notice_version}`}>
            <h3>{row.title}</h3>
            {noticeParagraphs(row.body).map((paragraph, index) => <p key={index}>{paragraph}</p>)}
          </article>
        ))}
      </section>
      <section aria-labelledby="direct-heading" data-testid="section-direct">
        <h2 id="direct-heading">1:1</h2>
        <p data-testid="text-direct-placeholder">1:1 대화는 서로 매치된 상대와만 할 수 있어요. 매치 화면에서 대화를 열어 주세요.</p>
        <Link href="/matches" className="text-link" data-testid="link-direct-matches">매치 보러 가기</Link>
      </section>
    </section>
  );
}
