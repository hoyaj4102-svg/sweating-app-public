import React, { useEffect, useRef, useState } from "react";
import { currentUnackedPrinciples, noticeParagraphs, readInbox, type InboxAnnouncement } from "./inbox";

export function PrinciplesGate() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const allowClose = useRef(false);
  const busyRef = useRef(false);
  const [pending, setPending] = useState<InboxAnnouncement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/messages", { credentials: "include", signal: controller.signal })
      .then(async (result) => (result.ok ? result.json() as Promise<unknown> : null))
      .then((payload) => {
        if (controller.signal.aborted || !payload) return;
        const next = currentUnackedPrinciples(readInbox(payload));
        if (next) setPending(next);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!pending || !dialog) return;
    if (!dialog.open) dialog.showModal();
    dialog.querySelector<HTMLButtonElement>("[data-testid='button-ack-principles']")?.focus();
  }, [pending]);

  const acknowledge = async () => {
    if (!pending || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await fetch("/api/messages/principles/acknowledge", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notice_version: pending.notice_version }),
      });
      if (!result.ok) {
        const payload = await result.json().catch(() => ({})) as { error?: string };
        throw new Error(payload.error || "운영 원칙을 확인하지 못했습니다.");
      }
      allowClose.current = true;
      setPending(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "운영 원칙을 확인하지 못했습니다.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  if (!pending) return null;
  const paragraphs = noticeParagraphs(pending.body);
  return (
    <dialog
      ref={dialogRef}
      className="principles-gate"
      aria-labelledby="principles-gate-title"
      aria-describedby="principles-gate-body"
      data-testid="dialog-principles"
      onCancel={(event) => event.preventDefault()}
      onClose={() => {
        if (allowClose.current) return;
        const dialog = dialogRef.current;
        if (dialog && !dialog.open) dialog.showModal();
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) event.preventDefault();
      }}
    >
      <h2 id="principles-gate-title">{pending.title}</h2>
      <div id="principles-gate-body" className="principles-gate-body">
        {paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="principles-gate-actions">
        <button
          type="button"
          className="button button-primary"
          aria-busy={busy}
          data-testid="button-ack-principles"
          onClick={() => void acknowledge()}
        >읽고 확인했습니다</button>
      </div>
    </dialog>
  );
}
