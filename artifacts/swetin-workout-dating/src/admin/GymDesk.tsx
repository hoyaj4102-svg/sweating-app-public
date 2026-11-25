import React, { useEffect, useState, type FormEvent } from "react";
import type { Gym } from "@workspace/api-client-react";

type OwnerSummary = {
  user_id: string;
  display_name: string | null;
};

async function readError(result: Response, fallback: string) {
  const payload = await result.json().catch(() => ({})) as { error?: string };
  return payload.error || fallback;
}

export function GymDesk({ gyms, onChanged }: { gyms: Gym[]; onChanged: () => void }) {
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [address, setAddress] = useState("");
  const [description, setDescription] = useState("");
  const [gymId, setGymId] = useState(gyms[0]?.id ?? "");
  const [email, setEmail] = useState("");
  const [owner, setOwner] = useState<OwnerSummary | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!gymId && gyms[0]) setGymId(gyms[0].id);
  }, [gymId, gyms]);

  useEffect(() => {
    if (!gymId) {
      setOwner(null);
      return;
    }
    let cancelled = false;
    void fetch(`/api/admin/gyms/${gymId}/owner`, { credentials: "include" })
      .then(async (result) => {
        if (!result.ok) throw new Error(await readError(result, "관장 정보를 불러오지 못했습니다."));
        return result.json() as Promise<{ owner: OwnerSummary | null }>;
      })
      .then((payload) => {
        if (!cancelled) setOwner(payload.owner);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "관장 정보를 불러오지 못했습니다.");
      });
    return () => {
      cancelled = true;
    };
  }, [gymId]);

  const createGym = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !city.trim() || !address.trim()) {
      setError("이름, 도시, 주소를 입력해 주세요.");
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const result = await fetch("/api/admin/gyms", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          city: city.trim(),
          address: address.trim(),
          description: description.trim() || null,
          latitude: null,
          longitude: null,
          image_url: null,
        }),
      });
      if (!result.ok) throw new Error(await readError(result, "체육관을 만들지 못했습니다."));
      setName("");
      setCity("");
      setAddress("");
      setDescription("");
      setMessage("체육관을 추가했습니다.");
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "체육관을 만들지 못했습니다.");
    } finally {
      setSaving(false);
    }
  };

  const assignOwner = async (event: FormEvent) => {
    event.preventDefault();
    if (!gymId || !email.trim()) {
      setError("체육관과 계정 이메일을 입력해 주세요.");
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const result = await fetch(`/api/admin/gyms/${gymId}/owner`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const payload = await result.json().catch(() => ({})) as { error?: string; owner?: OwnerSummary | null };
      if (!result.ok) throw new Error(payload.error || "관장을 지정하지 못했습니다.");
      setOwner(payload.owner ?? null);
      setEmail("");
      setMessage("관장을 지정했습니다.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "관장을 지정하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  };

  const removeOwner = async () => {
    if (!gymId) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const result = await fetch(`/api/admin/gyms/${gymId}/owner`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!result.ok) throw new Error(await readError(result, "관장 지정을 해제하지 못했습니다."));
      setOwner(null);
      setMessage("관장 지정을 해제했습니다.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "관장 지정을 해제하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="gym-desk">
      <form className="admin-create" onSubmit={(event) => void createGym(event)}>
        <div className="admin-create-head"><h2>체육관 등록</h2><span>관리자만 추가</span></div>
        <label htmlFor="gym-name">체육관 이름<input id="gym-name" value={name} onChange={(event) => setName(event.target.value)} data-testid="input-gym-name" /></label>
        <div className="admin-form-grid">
          <label htmlFor="gym-city">도시<input id="gym-city" value={city} onChange={(event) => setCity(event.target.value)} data-testid="input-gym-city" /></label>
          <label htmlFor="gym-address">주소<input id="gym-address" value={address} onChange={(event) => setAddress(event.target.value)} data-testid="input-gym-address" /></label>
        </div>
        <label htmlFor="gym-description">소개<textarea id="gym-description" value={description} onChange={(event) => setDescription(event.target.value)} rows={3} /></label>
        <button className="button button-primary" disabled={saving} data-testid="button-create-gym">{saving ? "저장 중…" : "체육관 추가"}</button>
      </form>
      <form className="admin-create" onSubmit={(event) => void assignOwner(event)}>
        <div className="admin-create-head"><h2>관장 지정</h2><span>가입된 계정만</span></div>
        <p className="attendance-note">이메일로 기존 계정을 찾습니다. 화면에는 이름만 남고, 이메일 주소는 다시 보여 주지 않습니다.</p>
        <label htmlFor="owner-gym">체육관
          <select id="owner-gym" value={gymId} onChange={(event) => setGymId(event.target.value)} data-testid="select-owner-gym">
            {gyms.map((gym) => <option value={gym.id} key={gym.id}>{gym.name}</option>)}
          </select>
        </label>
        <p data-testid="owner-current">{owner ? `현재 관장: ${owner.display_name || "이름 없는 계정"}` : "현재 관장: 없음"}</p>
        <label htmlFor="owner-email">계정 이메일
          <input id="owner-email" type="email" autoComplete="off" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="가입된 계정의 이메일" data-testid="input-owner-email" />
        </label>
        <div className="admin-row-actions">
          <button className="button button-primary" disabled={saving || Boolean(owner)} data-testid="button-assign-owner">관장 지정</button>
          <button type="button" disabled={saving || !owner} onClick={() => void removeOwner()} data-testid="button-remove-owner">지정 해제</button>
        </div>
      </form>
      {message && <p className="attendance-note" role="status">{message}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  );
}
