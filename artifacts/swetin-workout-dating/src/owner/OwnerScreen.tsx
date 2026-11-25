import React, { useEffect, useState, type ComponentType, type FormEvent, type ReactNode } from "react";
import type { ClassDetail, Gym } from "@workspace/api-client-react";
import { AGE_BANDS, ageBandLabel, isAgeBand, type AgeBand } from "@/explore/age-band";

const sports = ["러닝", "복싱", "근력 운동", "요가"];

type RosterEntry = {
  id: string;
  user_id: string;
  attendance_status: string;
  display_name: string | null;
};

const ATTENDANCE_LABEL: Record<string, string> = {
  registered: "신청",
  attended: "출석",
  no_show: "불참",
  cancelled: "취소",
};

type ClassDraft = {
  title: string;
  sportType: string;
  scheduledAt: string;
  duration: string;
  capacity: string;
  price: string;
  ageBand: AgeBand;
  status: "draft" | "published" | "cancelled";
  description: string;
};

const emptyDraft = (): ClassDraft => ({
  title: "",
  sportType: sports[0],
  scheduledAt: "",
  duration: "60",
  capacity: "8",
  price: "0",
  ageBand: "20_25",
  status: "published",
  description: "",
});

function toLocalInput(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

async function readError(result: Response, fallback: string) {
  const payload = await result.json().catch(() => ({})) as { error?: string };
  return payload.error || fallback;
}

function classBody(gymId: string, draft: ClassDraft) {
  return {
    gym_id: gymId,
    title: draft.title.trim(),
    sport_type: draft.sportType,
    description: draft.description.trim() || null,
    scheduled_at: new Date(draft.scheduledAt).toISOString(),
    duration_minutes: Number(draft.duration),
    capacity: Number(draft.capacity),
    price: Number(draft.price || 0),
    image_url: null,
    status: draft.status,
    age_band: draft.ageBand,
  };
}

function ClassEditor({
  item,
  saving,
  onSave,
}: {
  item: ClassDetail;
  saving: boolean;
  onSave: (draft: ClassDraft) => void;
}) {
  const [draft, setDraft] = useState<ClassDraft>({
    title: item.title,
    sportType: item.sport_type,
    scheduledAt: toLocalInput(item.scheduled_at),
    duration: String(item.duration_minutes),
    capacity: String(item.capacity),
    price: String(item.price),
    ageBand: isAgeBand(item.age_band) ? item.age_band : "20_25",
    status: item.status === "draft" ? "draft" : "published",
    description: item.description ?? "",
  });
  const setField = <Key extends keyof ClassDraft>(key: Key, value: ClassDraft[Key]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };
  return (
    <form className="admin-create owner-edit" onSubmit={(event) => { event.preventDefault(); onSave(draft); }}>
      <div className="admin-form-grid">
        <label>시간(분)<input type="number" min="1" value={draft.duration} onChange={(event) => setField("duration", event.target.value)} data-testid={`input-edit-duration-${item.id}`} /></label>
        <label>정원<input type="number" min="1" value={draft.capacity} onChange={(event) => setField("capacity", event.target.value)} /></label>
        <label>연령 구간
          <select value={draft.ageBand} onChange={(event) => { if (isAgeBand(event.target.value)) setField("ageBand", event.target.value); }} aria-label={`${item.title} 연령 구간`}>
            {AGE_BANDS.map((band) => <option key={band} value={band}>{ageBandLabel(band)}</option>)}
          </select>
        </label>
        <label>공개
          <select value={draft.status} onChange={(event) => setField("status", event.target.value === "draft" ? "draft" : "published")} aria-label={`${item.title} 공개`}>
            <option value="published">공개</option>
            <option value="draft">초안</option>
          </select>
        </label>
      </div>
      <div className="admin-row-actions">
        <button className="button button-primary" disabled={saving}>변경 저장</button>
        <button type="button" disabled={saving} onClick={() => onSave({ ...draft, status: "cancelled" })}>수업 취소</button>
      </div>
    </form>
  );
}

function Roster({ classId, onError }: { classId: string; onError: (message: string) => void }) {
  const [participants, setParticipants] = useState<RosterEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyUserId, setBusyUserId] = useState("");
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/owner/classes/${classId}/participants`, { credentials: "include" })
      .then(async (result) => {
        if (!result.ok) throw new Error(await readError(result, "참가자 목록을 불러오지 못했습니다."));
        return result.json() as Promise<RosterEntry[]>;
      })
      .then((rows) => {
        if (!cancelled) setParticipants(rows);
      })
      .catch((err: unknown) => {
        if (!cancelled) onError(err instanceof Error ? err.message : "참가자 목록을 불러오지 못했습니다.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [classId, version, onError]);

  const record = async (userId: string, attendanceStatus: "attended" | "no_show") => {
    setBusyUserId(userId);
    onError("");
    try {
      const result = await fetch(`/api/owner/classes/${classId}/participants/${userId}/attendance`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attendance_status: attendanceStatus }),
      });
      if (!result.ok) throw new Error(await readError(result, "출석을 기록하지 못했습니다."));
      setVersion((current) => current + 1);
    } catch (err) {
      onError(err instanceof Error ? err.message : "출석을 기록하지 못했습니다.");
    } finally {
      setBusyUserId("");
    }
  };

  return (
    <div className="attendance-panel" data-testid={`owner-roster-${classId}`}>
      <p className="attendance-note">참가자 이름과 출석만 표시합니다. 수업 시작부터 종료 후 24시간까지 기록할 수 있습니다.</p>
      {loading ? <div className="skeleton-line" /> : participants.length === 0 ? <p className="attendance-note">참가자가 없습니다.</p> : participants.map((person) => {
        const locked = person.attendance_status === "cancelled";
        const busy = busyUserId === person.user_id;
        return (
          <div className="attendance-person" key={person.id}>
            <span><strong>{person.display_name || "참가자"}</strong> · {ATTENDANCE_LABEL[person.attendance_status] ?? person.attendance_status}</span>
            <span className="attendance-actions">
              <button type="button" disabled={busy || locked} onClick={() => void record(person.user_id, "attended")}>출석</button>
              <button type="button" disabled={busy || locked} onClick={() => void record(person.user_id, "no_show")}>불참</button>
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function OwnerScreen({
  Shell,
  initialGyms,
}: {
  Shell: ComponentType<{ children: ReactNode }>;
  initialGyms: Gym[];
}) {
  const [gyms] = useState(initialGyms);
  const [gymId, setGymId] = useState(initialGyms[0]?.id ?? "");
  const [classes, setClasses] = useState<ClassDetail[]>([]);
  const [draft, setDraft] = useState<ClassDraft>(emptyDraft);
  const [editing, setEditing] = useState<string>("");
  const [rosterClassId, setRosterClassId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const gym = gyms.find((item) => item.id === gymId) ?? gyms[0];

  const load = async (nextGymId = gymId) => {
    setLoading(true);
    try {
      const result = await fetch(`/api/owner/classes?gym_id=${encodeURIComponent(nextGymId)}`, { credentials: "include" });
      if (!result.ok) throw new Error(await readError(result, "클래스를 불러오지 못했습니다."));
      setClasses(await result.json() as ClassDetail[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "클래스를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!gymId) return;
    void load(gymId);
  }, [gymId]);

  const setField = <Key extends keyof ClassDraft>(key: Key, value: ClassDraft[Key]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const createClass = async (event: FormEvent) => {
    event.preventDefault();
    if (!gymId || !draft.title.trim() || !draft.scheduledAt) {
      setError("제목과 일정을 입력해 주세요.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const result = await fetch("/api/owner/classes", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(classBody(gymId, { ...draft, status: draft.status === "cancelled" ? "draft" : draft.status })),
      });
      if (!result.ok) throw new Error(await readError(result, "클래스를 만들지 못했습니다."));
      setDraft(emptyDraft());
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "클래스를 만들지 못했습니다.");
    } finally {
      setSaving(false);
    }
  };

  const saveEdit = async (item: ClassDetail, next: ClassDraft) => {
    setSaving(true);
    setError("");
    try {
      const result = await fetch(`/api/owner/classes/${item.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(classBody(item.gym_id, next)),
      });
      if (!result.ok) throw new Error(await readError(result, "클래스를 수정하지 못했습니다."));
      setEditing("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "클래스를 수정하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  };

  const complete = async (item: ClassDetail) => {
    setSaving(true);
    setError("");
    try {
      const result = await fetch(`/api/owner/classes/${item.id}/complete`, {
        method: "PATCH",
        credentials: "include",
      });
      if (!result.ok) throw new Error(await readError(result, "클래스를 완료 처리하지 못했습니다."));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "클래스를 완료 처리하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Shell>
      <section className="admin-page wrap owner-page">
        <div className="page-heading">
          <p className="eyebrow">OWNER</p>
          <h1>내 체육관<br /><em>클래스.</em></h1>
          <p>이 체육관의 수업만 만들고, 고치고, 취소할 수 있습니다. 다른 체육관의 수업과 참가자는 열리지 않습니다.</p>
        </div>
        {gyms.length > 1 && (
          <label className="owner-gym-switch" htmlFor="owner-gym-switch">체육관
            <select id="owner-gym-switch" value={gymId} onChange={(event) => setGymId(event.target.value)} data-testid="select-owned-gym">
              {gyms.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
            </select>
          </label>
        )}
        {gym && <p className="attendance-note">{gym.name} · {gym.city}</p>}
        {error && <p className="form-error" role="alert">{error}</p>}
        <form className="admin-create" onSubmit={(event) => void createClass(event)}>
          <div className="admin-create-head"><h2>클래스 개설</h2><span>{gym?.name ?? "내 체육관"}</span></div>
          <label htmlFor="owner-class-title">클래스 이름<input id="owner-class-title" value={draft.title} onChange={(event) => setField("title", event.target.value)} data-testid="input-class-title" /></label>
          <div className="admin-form-grid">
            <label htmlFor="owner-class-sport">운동
              <select id="owner-class-sport" value={draft.sportType} onChange={(event) => setField("sportType", event.target.value)}>
                {sports.map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
            <label htmlFor="owner-class-when">일정<input id="owner-class-when" type="datetime-local" value={draft.scheduledAt} onChange={(event) => setField("scheduledAt", event.target.value)} data-testid="input-class-when" /></label>
            <label htmlFor="owner-class-duration">시간(분)<input id="owner-class-duration" type="number" min="1" value={draft.duration} onChange={(event) => setField("duration", event.target.value)} data-testid="input-class-duration" /></label>
            <label htmlFor="owner-class-capacity">정원<input id="owner-class-capacity" type="number" min="1" value={draft.capacity} onChange={(event) => setField("capacity", event.target.value)} data-testid="input-class-capacity" /></label>
            <label htmlFor="owner-class-band">연령 구간
              <select id="owner-class-band" value={draft.ageBand} onChange={(event) => { if (isAgeBand(event.target.value)) setField("ageBand", event.target.value); }} data-testid="select-owner-age-band">
                {AGE_BANDS.map((band) => <option key={band} value={band}>{ageBandLabel(band)}</option>)}
              </select>
            </label>
            <label htmlFor="owner-class-visibility">공개
              <select id="owner-class-visibility" value={draft.status === "cancelled" ? "draft" : draft.status} onChange={(event) => setField("status", event.target.value === "draft" ? "draft" : "published")} data-testid="select-owner-visibility">
                <option value="published">공개</option>
                <option value="draft">초안</option>
              </select>
            </label>
          </div>
          <button className="button button-primary" disabled={saving} data-testid="button-create-class">{saving ? "저장 중…" : "클래스 추가"}</button>
        </form>
        {loading ? <div className="admin-list"><div className="skeleton-line" /></div> : (
          <div className="admin-list">
            {classes.length ? classes.map((item) => {
              const editable = item.status === "draft" || item.status === "published";
              return (
                <div className="admin-class" key={item.id}>
                  <div className="admin-row">
                    <div>
                      <span className={`status-dot ${item.status}`} /> <strong>{item.title}</strong>
                      <small>{item.sport_type} · {item.duration_minutes}분 · {ageBandLabel(item.age_band)} · {formatDate(item.scheduled_at)}</small>
                    </div>
                    <div className="admin-row-actions">
                      <span>{item.participant_count}/{item.capacity}명</span>
                      <button type="button" onClick={() => setRosterClassId(rosterClassId === item.id ? "" : item.id)}>참가자</button>
                      {item.status === "completed" ? <span className="status-pill done">완료됨</span> : item.status === "cancelled" ? <span className="status-pill">취소됨</span> : (
                        <>
                          <button type="button" disabled={saving} onClick={() => void complete(item)}>완료 처리</button>
                          <button type="button" onClick={() => setEditing(editing === item.id ? "" : item.id)}>{editing === item.id ? "닫기" : "수정"}</button>
                        </>
                      )}
                    </div>
                  </div>
                  {rosterClassId === item.id && <Roster classId={item.id} onError={setError} />}
                  {editing === item.id && editable && <ClassEditor item={item} saving={saving} onSave={(next) => void saveEdit(item, next)} />}
                </div>
              );
            }) : <div className="admin-empty">이 체육관에 클래스가 아직 없어요.</div>}
          </div>
        )}
      </section>
    </Shell>
  );
}
