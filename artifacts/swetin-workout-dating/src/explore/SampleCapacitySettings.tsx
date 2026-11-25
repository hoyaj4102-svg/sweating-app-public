import { useState, type FormEvent } from "react";
import { Link } from "wouter";
import { ArrowUpRight, Check, FlaskConical } from "lucide-react";
import type { ClassDetail } from "@workspace/api-client-react";
import { SPORT_FILTERS } from "./config";
import { splitEven, parseCount, validateCapacity, type GenderCapacity } from "./capacity";
import { CapacityCompact } from "./CapacityViews";
import { addCreated } from "./demo-store";
import { useDemoClasses, type DemoClass } from "./demo-data";

const SPORTS = SPORT_FILTERS.filter(s => s !== "전체");
let seq = 0;

function buildSample(title: string, sport: string, total: number, cap: GenderCapacity): DemoClass {
  const when = new Date(); when.setDate(when.getDate() + 1); when.setHours(19, 0, 0, 0);
  const item: ClassDetail = {
    id: `demo-sample-${Date.now().toString(36)}-${++seq}`, gym_id: "demo-gym-sample", title, sport_type: sport,
    description: "정원 설정 샘플로 만든 임시 클래스예요.", scheduled_at: when.toISOString(), duration_minutes: 60, capacity: total, price: 0,
    image_url: null, status: "published", created_at: new Date().toISOString(),
    gym: { id: "demo-gym-sample", name: "샘플 · 임시 장소", address: "예시시 (샘플 주소)", city: "예시시", created_at: new Date(0).toISOString() },
    participant_count: 0, remaining_slots: total, is_joined: false,
  };
  const label = cap.enabled ? `남성 ${cap.male.capacity}명 · 여성 ${cap.female.capacity}명` : `성별 제한 없이 ${total}명`;
  return { item, extra: {
    host: { name: "샘플 호스트", role: "가상의 운영자", bio: "정원 설정 샘플에서 만든 가상의 호스트입니다." },
    fullDescription: [`정원 설정 샘플로 만든 임시 클래스예요. ${label}으로 모집합니다.`, "브라우저 메모리에만 있어 새로고침하면 사라져요."],
    meetingPoint: "샘플 장소 (실제 위치 없음)", preparation: ["샘플 클래스라 준비물이 없어요."], cautions: ["실제 신청은 진행되지 않습니다."],
    program: [{ title: "샘플 프로그램", description: "화면 확인용 구성이에요.", minutes: 60 }], imageCredit: "해당 없음 (이미지 없음)",
  } };
}

export function SampleCapacitySettings({ embedded = false }: { embedded?: boolean }) {
  const all = useDemoClasses();
  const mine = all.filter(c => c.item.id.startsWith("demo-sample-"));
  const [title, setTitle] = useState("");
  const [sport, setSport] = useState(SPORTS[0]);
  const [total, setTotal] = useState("8");
  const [enabled, setEnabled] = useState(true);
  const [male, setMale] = useState("4");
  const [female, setFemale] = useState("4");
  const [touched, setTouched] = useState(false);
  const [saved, setSaved] = useState<{ id: string; title: string } | null>(null);

  const result = validateCapacity({ total, enabled, male, female });
  const titleError = !title.trim() ? "클래스 이름을 입력해 주세요." : "";
  const show = touched;
  const changeTotal = (v: string) => {
    setTotal(v); setSaved(null);
    const n = parseCount(v); const even = n === null ? null : splitEven(n);
    if (enabled && even) { setMale(String(even.male)); setFemale(String(even.female)); }
  };
  const submit = (e: FormEvent) => {
    e.preventDefault(); setTouched(true);
    if (titleError || !result.ok || !result.values) return;
    const v = result.values;
    const cap: GenderCapacity = enabled ? { enabled: true, male: { capacity: v.male, joined: 0 }, female: { capacity: v.female, joined: 0 } } : { enabled: false };
    const entry = buildSample(title.trim(), sport, v.total, cap);
    addCreated(entry, cap);
    setSaved({ id: entry.item.id, title: entry.item.title });
    setTitle(""); setTouched(false);
  };
  const previewCap: GenderCapacity | null = result.values
    ? (enabled ? { enabled: true, male: { capacity: result.values.male, joined: 0 }, female: { capacity: result.values.female, joined: 0 } } : { enabled: false }) : null;

  return (
    <section className="cap-settings wrap" data-testid="screen-capacity-settings">
      <p className="eyebrow">{embedded ? "ADMIN · SAMPLE" : "SAMPLE PREVIEW / CAPACITY"}</p>
      <h1>성별 정원 설정<br /><em>샘플.</em></h1>
      <div className="ex-demo" role="note"><strong>SAMPLE ONLY</strong><span>실제 관리자 기능이 아니에요. 저장하면 이 브라우저 메모리에만 임시로 추가되고, 서버·저장소에는 아무것도 기록되지 않아요. 새로고침하면 사라집니다.</span></div>
      <form className="cap-form" onSubmit={submit} noValidate>
        <div className="cap-field">
          <label htmlFor="cap-title">클래스 이름</label>
          <input id="cap-title" data-testid="input-sample-title" value={title} maxLength={40} onChange={e => { setTitle(e.target.value); setSaved(null); }} placeholder="예: 토요일 아침 러닝" aria-invalid={show && !!titleError} aria-describedby="cap-title-err" />
          <p className="cap-err" id="cap-title-err" role={show && titleError ? "alert" : undefined}>{show && titleError}</p>
        </div>
        <div className="cap-field">
          <label htmlFor="cap-sport">종목</label>
          <select id="cap-sport" data-testid="select-sample-sport" value={sport} onChange={e => setSport(e.target.value)}>{SPORTS.map(s => <option key={s}>{s}</option>)}</select>
        </div>
        <div className="cap-field">
          <label htmlFor="cap-total">총정원 (명)</label>
          <input id="cap-total" data-testid="input-total-capacity" inputMode="numeric" value={total} onChange={e => changeTotal(e.target.value)} aria-invalid={!!result.errors.total} aria-describedby="cap-total-err" />
          <p className="cap-err" id="cap-total-err" role={result.errors.total ? "alert" : undefined}>{result.errors.total}</p>
        </div>
        <div className="cap-switch-row">
          <div><strong id="cap-switch-label">성별 정원 관리</strong><small>{enabled ? "남성·여성 슬롯을 따로 운영해요." : "성별 구분 없이 총정원만 운영해요."}</small></div>
          <button type="button" role="switch" aria-checked={enabled} aria-labelledby="cap-switch-label" className={`cap-switch ${enabled ? "on" : ""}`} onClick={() => { setEnabled(v => !v); setSaved(null); }} data-testid="switch-gender-limits"><i /></button>
        </div>
        {enabled && (
          <div className="cap-quotas">
            <div className="cap-field">
              <label htmlFor="cap-male">남성 정원</label>
              <input id="cap-male" data-testid="input-male-capacity" inputMode="numeric" value={male} onChange={e => { setMale(e.target.value); setSaved(null); }} aria-invalid={!!result.errors.male || !!result.errors.sum} aria-describedby="cap-male-err" />
              <p className="cap-err" id="cap-male-err">{result.errors.male}</p>
            </div>
            <div className="cap-field">
              <label htmlFor="cap-female">여성 정원</label>
              <input id="cap-female" data-testid="input-female-capacity" inputMode="numeric" value={female} onChange={e => { setFemale(e.target.value); setSaved(null); }} aria-invalid={!!result.errors.female || !!result.errors.sum} aria-describedby="cap-female-err" />
              <p className="cap-err" id="cap-female-err">{result.errors.female}</p>
            </div>
            <div className="cap-quota-foot">
              <button type="button" className="cap-ghost" data-testid="button-split-even" disabled={!splitEven(parseCount(total) ?? 0)} onClick={() => { const s = splitEven(parseCount(total) ?? 0); if (s) { setMale(String(s.male)); setFemale(String(s.female)); } }}>50:50으로 맞추기</button>
              <span className="cap-sum" data-testid="text-quota-sum">{(parseCount(male) ?? 0) + (parseCount(female) ?? 0)} / {parseCount(total) ?? 0}명</span>
            </div>
            {result.info && <p className="cap-info" role="status" data-testid="text-odd-info">{result.info}</p>}
            {result.errors.sum && <p className="cap-err cap-err-block" role="alert" data-testid="text-sum-error">{result.errors.sum}</p>}
          </div>
        )}
        {previewCap && result.values && (
          <div className="cap-preview" aria-label="카드 미리보기"><p className="eyebrow">LIST PREVIEW</p>
            <CapacityCompact item={{ id: "preview", capacity: result.values.total, participant_count: 0, remaining_slots: result.values.total }} cap={previewCap} /></div>
        )}
        <button className="button button-primary" type="submit" data-testid="button-save-sample">샘플로 임시 저장 (브라우저 메모리) <ArrowUpRight size={16} /></button>
        {show && (titleError || !result.ok) && <p className="cap-err cap-err-block" role="alert">입력 내용을 확인한 뒤 다시 저장해 주세요.</p>}
        {saved && (
          <div className="cap-saved" role="status" data-testid="status-sample-saved"><Check size={16} />
            <div><strong>샘플 “{saved.title}” 추가됨</strong><span>임시 저장이에요. 새로고침하면 사라집니다.</span>
              <span className="cap-saved-links"><Link href="/home">목록에서 보기</Link><Link href={`/classes/${encodeURIComponent(saved.id)}`}>상세 보기</Link></span></div></div>
        )}
      </form>
      <div className="cap-mine">
        <p className="eyebrow"><FlaskConical size={11} /> 이번 세션 샘플 {mine.length}개</p>
        {mine.length === 0 ? <p className="cap-note">아직 만든 샘플이 없어요.</p> : mine.map(c => <Link key={c.item.id} href={`/classes/${encodeURIComponent(c.item.id)}`} className="cap-mine-row" data-testid={`link-sample-${c.item.id}`}><span>{c.item.title}</span><small>총 {c.item.capacity}명</small></Link>)}
      </div>
    </section>
  );
}
