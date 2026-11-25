import { Info } from "lucide-react";
import type { ClassDetail } from "@workspace/api-client-react";
import { GENDERS, GENDER_LABEL, fullMessage, slotView, type Gender, type GenderCapacity } from "./capacity";

function Bar({ pct, full }: { pct: number; full: boolean }) {
  return <span className={`cap-bar ${full ? "is-full" : ""}`} aria-hidden="true"><i style={{ transform: `scaleX(${pct / 100})` }} /></span>;
}

/** Compact list summary: numbers + thin progress only. */
export function CapacityCompact({ item, cap }: { item: Pick<ClassDetail, "id" | "capacity" | "participant_count" | "remaining_slots">; cap: GenderCapacity }) {
  const totalPct = item.capacity > 0 ? Math.min(100, Math.round((item.participant_count / item.capacity) * 100)) : 0;
  return (
    <div className="cap-mini" data-testid={`capacity-summary-${item.id}`}>
      <div className="cap-mini-total"><b>총 {item.capacity}명 모집</b><span>{item.remaining_slots > 0 ? `잔여 ${item.remaining_slots}자리` : "마감"}</span></div>
      {cap.enabled
        ? GENDERS.map(gd => { const v = slotView(cap[gd]); return (
          <div className={`cap-row ${v.full ? "is-full" : ""}`} key={gd} data-testid={`capacity-${gd}-${item.id}`}>
            <span className="cap-row-label">{GENDER_LABEL[gd]}</span>
            <Bar pct={v.pct} full={v.full} />
            <b>{v.joined}/{v.capacity}명</b>
            <em>{v.capacity <= 0 ? "정원 없음" : v.full ? "마감" : `잔여 ${v.remaining}`}</em>
          </div>); })
        : <div className="cap-row"><span className="cap-row-label">전체</span><Bar pct={totalPct} full={item.remaining_slots < 1} /><b>{item.participant_count}/{item.capacity}명</b><em>성별 제한 없음</em></div>}
    </div>
  );
}

type DetailProps = {
  item: Pick<ClassDetail, "id" | "capacity" | "participant_count" | "remaining_slots">;
  cap: GenderCapacity;
  sample: Gender | null;
  onSample: (g: Gender | null) => void;
};

/** Detailed separate slot cards. Counts only, never names, photos or profiles. */
export function CapacityDetail({ item, cap, sample, onSample }: DetailProps) {
  const selectedFull = cap.enabled && sample ? slotView(cap[sample]).full : false;
  return (
    <section className="ex-section cap-detail" data-testid="section-capacity">
      <h2>참가 현황</h2>
      <p className="ex-na">참가자 수만 보여드려요. 수업 전에는 이름·사진·프로필이 공개되지 않습니다.</p>
      <div className="cap-cards">
        {cap.enabled ? GENDERS.map(gd => { const v = slotView(cap[gd]); return (
          <article className={`cap-card ${v.full ? "is-full" : "is-open"}`} key={gd} data-testid={`card-slot-${gd}`}>
            <header><h3>{GENDER_LABEL[gd]} 슬롯</h3><span className="cap-pill" data-testid={`status-slot-${gd}`}>{v.label}</span></header>
            <Bar pct={v.pct} full={v.full} />
            <dl><div><dt>모집 정원</dt><dd>{v.capacity}명</dd></div><div><dt>현재 신청</dt><dd>{v.joined}명</dd></div><div><dt>잔여</dt><dd>{v.remaining}자리</dd></div></dl>
          </article>); })
          : (() => { const full = item.remaining_slots < 1; const pct = item.capacity > 0 ? Math.min(100, Math.round(item.participant_count / item.capacity * 100)) : 0; return (
            <article className={`cap-card cap-card-total ${full ? "is-full" : "is-open"}`} data-testid="card-slot-total">
              <header><h3>전체 정원</h3><span className="cap-pill">{full ? "마감" : "모집 중"}</span></header>
              <Bar pct={pct} full={full} />
              <dl><div><dt>모집 정원</dt><dd>{item.capacity}명</dd></div><div><dt>현재 신청</dt><dd>{item.participant_count}명</dd></div><div><dt>잔여</dt><dd>{item.remaining_slots}자리</dd></div></dl>
              <p className="cap-note">이 클래스는 성별 구분 없이 총정원으로 운영돼요.</p>
            </article>); })()}
      </div>
      {cap.enabled && (
        <div className="cap-sample" data-testid="panel-sample-gender">
          <p className="cap-sample-title"><Info size={14} /> 샘플 버튼 상태 미리보기</p>
          <p className="cap-note">아래 선택은 화면 확인용 가상의 참가자 성별이에요. 내 계정 정보와 무관하며 실제 신청은 진행되지 않습니다.</p>
          <div className="cap-seg" role="group" aria-label="샘플 참가자 성별 선택">
            {GENDERS.map(gd => <button type="button" key={gd} aria-pressed={sample === gd} className={sample === gd ? "active" : ""} onClick={() => onSample(sample === gd ? null : gd)} data-testid={`button-sample-gender-${gd}`}>샘플 {GENDER_LABEL[gd]}</button>)}
          </div>
          <p className={`cap-sample-result ${sample ? (selectedFull ? "is-full" : "is-open") : ""}`} role="status" data-testid="text-sample-result">
            {!sample ? "성별을 고르면 신청 버튼이 어떻게 보이는지 확인할 수 있어요." : selectedFull ? fullMessage(sample) : `샘플 ${GENDER_LABEL[sample]} 슬롯은 자리가 있어요. 샘플이라 실제 신청은 되지 않아요.`}
          </p>
        </div>
      )}
    </section>
  );
}
