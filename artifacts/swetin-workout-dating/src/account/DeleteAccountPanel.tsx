import React, { useState, type FormEvent } from "react";
import { deleteMyAccount } from "@workspace/api-client-react";
import { userFacingMessage } from "@/auth/user-message";
import { DELETE_CONFIRMATION, GYM_OWNER_DELETE_COPY, deletionConfirmed } from "./delete-account";

export function DeleteAccountPanel({ onDeleted }: { onDeleted: () => void }) {
  const [open, setOpen] = useState(false);
  const [phrase, setPhrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ready = deletionConfirmed(phrase);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError("");
    try {
      await deleteMyAccount({ confirm: DELETE_CONFIRMATION });
      onDeleted();
    } catch (err) {
      setError(userFacingMessage(err, "계정을 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요."));
      setBusy(false);
    }
  };

  return (
    <section className="delete-account" data-testid="section-delete-account">
      <h2>회원 탈퇴</h2>
      <p>계정, 프로필, 참가, 관심 표현, 매치, 동의 기록이 삭제됩니다. 사진 보관함이 생기면 그 파일도 함께 지웁니다.</p>
      <p>{GYM_OWNER_DELETE_COPY}</p>
      {!open ? (
        <button type="button" className="text-link" onClick={() => setOpen(true)} data-testid="button-delete-account">회원 탈퇴</button>
      ) : (
        <form onSubmit={submit} className="delete-account-confirm">
          <p>삭제한 계정은 되돌릴 수 없어요. 확인하려면 <strong>{DELETE_CONFIRMATION}</strong>를 입력해 주세요.</p>
          <label>
            확인 문구
            <input value={phrase} onChange={(event) => setPhrase(event.target.value)} autoComplete="off" data-testid="input-delete-confirm" />
          </label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button type="submit" className="button button-primary" disabled={!ready || busy} data-testid="button-delete-confirm">
            {busy ? "삭제 중…" : "정말로 탈퇴합니다"}
          </button>
        </form>
      )}
    </section>
  );
}
