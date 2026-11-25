import React, { useEffect, useState, type FormEvent } from "react";

type OwnerNotice = {
  title: string;
  body: string;
  published_at: string;
  notice_version: string;
};

export function OwnerNotices() {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [notices, setNotices] = useState<OwnerNotice[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = async () => {
    const result = await fetch("/api/admin/announcements", { credentials: "include" });
    if (!result.ok) throw new Error("관장 공지를 불러오지 못했습니다.");
    const payload = await result.json() as { announcements?: OwnerNotice[] };
    setNotices(payload.announcements ?? []);
  };

  useEffect(() => {
    let cancelled = false;
    void load().catch((err: unknown) => {
      if (!cancelled) setError(err instanceof Error ? err.message : "관장 공지를 불러오지 못했습니다.");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const publish = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim() || !body.trim()) {
      setError("제목과 본문을 입력해 주세요.");
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const result = await fetch("/api/admin/announcements", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), body: body.trim() }),
      });
      const payload = await result.json().catch(() => ({})) as { error?: string };
      if (!result.ok) throw new Error(payload.error || "관장 공지를 올리지 못했습니다.");
      setTitle("");
      setBody("");
      setMessage("관장 공지를 올렸습니다.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "관장 공지를 올리지 못했습니다.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="owner-notices" data-testid="admin-owner-notices">
      <form className="admin-create" onSubmit={(event) => void publish(event)}>
        <div className="admin-create-head"><h2>관장 공지</h2><span>승인된 관장에게 공개</span></div>
        <p className="attendance-note">운영 원칙 문구는 버전으로 고정되어 있습니다. 이 화면에서는 관장 공지만 작성합니다.</p>
        <label htmlFor="notice-title">제목
          <input id="notice-title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} data-testid="input-notice-title" />
        </label>
        <label htmlFor="notice-body">본문
          <textarea id="notice-body" value={body} onChange={(event) => setBody(event.target.value)} rows={5} maxLength={8000} data-testid="input-notice-body" />
        </label>
        <button className="button button-primary" disabled={saving} data-testid="button-publish-notice">{saving ? "올리는 중…" : "공지 올리기"}</button>
      </form>
      {message && <p className="attendance-note" role="status">{message}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="admin-list" data-testid="list-owner-notices">
        {notices.map((notice) => (
          <article className="admin-row" key={notice.notice_version}>
            <div>
              <strong>{notice.title}</strong>
              <small>{notice.body}</small>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
