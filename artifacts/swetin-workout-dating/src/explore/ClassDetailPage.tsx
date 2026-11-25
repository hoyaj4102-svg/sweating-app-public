import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useSearch } from "wouter/use-browser-location";
import { ArrowLeft } from "lucide-react";
import { getClass, joinClass } from "@workspace/api-client-react";
import type { ClassDetail } from "@workspace/api-client-react";
import { DemoBanner } from "./ExploreHome";
import { formatDateTime, formatPrice, isClassDemoMode, isUxDemoMode, type ExploreProps } from "./config";
import { CapacityDetail } from "./CapacityViews";
import { GENDER_LABEL, fullMessage, slotView, type Gender } from "./capacity";
import { findDemoClass, getDemoCapacity, useDemoClasses, type DemoExtra } from "./demo-data";
import { safeHomeReturn } from "./home-filters";
import { classPrograms } from "./programs";
import { DETAIL_META, POLICY_UNKNOWN, SLOGAN, TIER_LABEL, UNKNOWN } from "./detail-content";
import { SAMPLE_STATES, SAMPLE_STATE_LABEL, applySampleState, getDetailCtaState, parseSampleState, recruitmentBadge } from "./detail-state";
import { DetailAction } from "./DetailAction";
import { classLoginUrl, classProfileUrl } from "./auth-return";
import { ageBandLabel, joinEligibilityLabel } from "./age-band";
import { Card, Fact, Host, ListAccordion, PrivacyNote, RefundAccordion, Timeline } from "./DetailSections";
import "./detail-brand.css";
import "../visual-v2/demo-join.css";

function JoinChooser({ onClose, onDemo, onReal }: { onClose: () => void; onDemo: () => void; onReal: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const d = ref.current; d?.showModal(); return () => { if (d?.open) d.close(); }; }, []);
  return (
    <dialog ref={ref} className="dj-chooser" aria-label="참가 방식 선택" data-testid="dialog-join-chooser"
      onCancel={e => { e.preventDefault(); onClose(); }}
      onKeyDown={e => {
        if (e.key !== "Tab") return;
        const c = [...e.currentTarget.querySelectorAll<HTMLElement>("button:not([disabled])")];
        const f = c[0], l = c[c.length - 1], a = document.activeElement;
        if ((e.shiftKey && a === f) || (!e.shiftKey && a === l) || a === e.currentTarget) { e.preventDefault(); (e.shiftKey ? l : f)?.focus(); }
      }}>
      <div>
        <h2>참가 방식을 선택하세요</h2>
        <p className="dj-warn" role="note">개발용 미리보기 — 실제 참가, 매칭 및 결제가 진행되지 않습니다.</p>
        <button type="button" className="dj-btn fill" onClick={onDemo} data-testid="button-join-demo">데모로 참가 흐름 체험하기</button>
        <button type="button" className="dj-btn" onClick={onReal} data-testid="button-join-real">실제 로그인하고 참가하기</button>
        <button type="button" className="dj-btn" onClick={onClose} data-testid="button-join-chooser-cancel">닫기</button>
      </div>
    </dialog>
  );
}

type Load = { phase: "loading" } | { phase: "notfound" } | { phase: "error" } | { phase: "ready"; item: ClassDetail; extra?: DemoExtra };

export function ClassDetailPage({ id, Shell, session, demoOnly = false, demoBanner }: ExploreProps & { id: string; demoOnly?: boolean; demoBanner?: ReactNode }) {
  const forcedDemo = demoOnly && isUxDemoMode;
  const [, navigate] = useLocation();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const from = params.get("from");
  const backHref = forcedDemo ? "/preview/classes" : safeHomeReturn(params.get("back")) ?? (from ? `/home?sport=${encodeURIComponent(from)}` : "/home");
  const rawQuery = search.replace(/^\?/, "");
  const classHref = forcedDemo ? `/preview/detail?class=${encodeURIComponent(id)}` : `/classes/${encodeURIComponent(id)}${rawQuery ? `?${rawQuery}` : ""}`;
  const [load, setLoad] = useState<Load>({ phase: "loading" });
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [guide, setGuide] = useState(false);
  const [sampleGender, setSampleGender] = useState<Gender | null>(null);
  const sampleState = (isClassDemoMode ? parseSampleState(params.get("sampleState")) : null) ?? "default";
  const demoSnap = useDemoClasses();
  const [chooser, setChooser] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoad({ phase: "loading" }); setMessage(""); setGuide(false); setSampleGender(null);
    if (isClassDemoMode || forcedDemo) {
      const demo = findDemoClass(id);
      setLoad(demo ? { phase: "ready", item: demo.item, extra: demo.extra } : { phase: "notfound" });
      return;
    }
    getClass(id)
      .then(item => { if (!cancelled) setLoad({ phase: "ready", item }); })
      .catch(err => { if (!cancelled) setLoad({ phase: (err as { status?: number })?.status === 404 ? "notfound" : "error" }); });
    return () => { cancelled = true; };
  }, [id, tick, demoSnap, forcedDemo]);

  const join = useCallback(async () => {
    if (load.phase !== "ready") return;
    if (isClassDemoMode) {
      const dc = getDemoCapacity(id);
      if (dc?.enabled && sampleGender && slotView(dc[sampleGender]).full) { setGuide(false); setMessage(fullMessage(sampleGender)); return; }
      setGuide(!session);
      setMessage(!session
        ? "참가 신청은 로그인 후 가능해요. 지금은 샘플 미리보기라 로그인해도 실제 신청은 진행되지 않습니다."
        : "샘플 클래스라 실제 신청은 진행되지 않아요. 화면 확인용으로만 사용해 주세요.");
      return;
    }
    if (!session) { setGuide(true); setMessage("참가 신청은 로그인 후 가능해요. 로그인 후 이 화면으로 돌아와 직접 신청해 주세요."); return; }
    if (!session.profile) { navigate(classProfileUrl(classHref)); return; }
    setBusy(true); setMessage(""); setGuide(false);
    try {
      await joinClass(id);
      setLoad(current => current.phase === "ready" && current.item.id === id
        ? { ...current, item: { ...current.item, is_joined: true, participant_count: current.item.participant_count + 1, remaining_slots: Math.max(0, current.item.remaining_slots - 1) } }
        : current);
      setMessage("참가 신청이 완료됐어요. 클래스 전에는 서로의 프로필을 볼 수 없어요.");
      try { const next = await getClass(id); setLoad({ phase: "ready", item: next }); } catch { setMessage("신청은 완료됐어요. 최신 정보는 화면을 다시 열어 확인해 주세요."); }
    } catch (err) {
      const apiError = (err as { data?: { error?: string } })?.data?.error;
      setMessage(typeof apiError === "string" && /^[가-힣0-9\s.,!?~…·’'()\-]+$/.test(apiError) ? apiError : "참가 신청을 완료하지 못했어요. 잠시 후 다시 시도해 주세요.");
    } finally { setBusy(false); }
  }, [load, session, id, navigate, sampleGender, classHref]);

  const shown = useMemo(() => (load.phase === "ready" ? (load.extra ? applySampleState(load.item, sampleState) : load.item) : null), [load, sampleState]);

  if (load.phase !== "ready" || !shown) {
    return <div className="dt-v1"><Shell><section className="dt-state dt-wrap" data-testid={`state-detail-${load.phase}`}>
      <Link href={backHref} className="back-link" data-testid="link-back-list"><ArrowLeft size={15} /> 클래스 목록</Link>
      {load.phase === "loading" && <div className="skeleton-list" aria-busy="true"><div className="ex-skel tall" /><div className="skeleton-line" /><div className="skeleton-line" /></div>}
      {load.phase === "notfound" && <div><h1>클래스를 찾을 수 없어요.</h1><p>삭제되었거나 주소가 잘못되었을 수 있어요.</p></div>}
      {load.phase === "error" && <div className="dt-err" role="alert"><p>클래스 정보를 불러오지 못했어요.</p><button type="button" className="text-link" onClick={() => setTick(t => t + 1)} data-testid="button-retry">다시 불러오기</button></div>}
    </section></Shell></div>;
  }

  const item = shown;
  const extra = load.extra;
  const demo = !!extra;
  const meta = extra ? DETAIL_META[item.id] : undefined;
  const cap = isClassDemoMode ? getDemoCapacity(item.id) : undefined;
  const genderBlocked = !!(cap?.enabled && sampleGender && slotView(cap[sampleGender]).full);
  const cta = getDetailCtaState({ status: item.status, isJoined: item.is_joined, remaining: item.remaining_slots, scheduledAt: item.scheduled_at, genderBlocked, genderLabel: sampleGender ? GENDER_LABEL[sampleGender] : undefined });
  const steps = extra ? extra.program : classPrograms[item.title];
  const statusText = recruitmentBadge(item.status, item.remaining_slots, item.scheduled_at) ?? UNKNOWN;
  const scheduledDate = new Date(item.scheduled_at);
  const unknownTxt = <span>{UNKNOWN}</span>;

  return (
    <div className="dt-v1" data-testid="page-class-detail">
      <Shell>
        <div className="dt-wrap">
          <div className="dt-hero">
            {item.image_url ? <img src={item.image_url} alt={`${item.title} 대표 이미지`} /> : <div className="dt-hero-fallback">{item.sport_type}</div>}
            <Link href={backHref} className="dt-back" data-testid="link-back-list"><ArrowLeft size={16} /> 목록으로</Link>
            <div className="dt-hero-copy">
              <span className="dt-slogan">{SLOGAN}</span>
              <div className="dt-badges">
                <span className="dt-badge">{item.sport_type}</span>
                <span className="dt-badge state" data-testid="text-status">{statusText}</span>
                <span className={`dt-badge ${meta?.tier === "premium" ? "tier-premium" : ""}`} data-testid="class-tier">{meta ? TIER_LABEL[meta.tier] : `클래스 구분 ${UNKNOWN}`}</span>
              </div>
              <h1>{item.title}</h1>
              <p className="dt-intro">{item.description || UNKNOWN}</p>
            </div>
          </div>

          <div className="dt-layout">
            <div className="dt-main">
              {forcedDemo && demoBanner}
              {isClassDemoMode && <DemoBanner />}
              {isClassDemoMode && demo && (
                <label className="dt-state-select">
                  <b>상태 UI 샘플 (실제 요청 아님)</b>
                  <select value={sampleState} onChange={e => {
                    const next = parseSampleState(e.target.value) ?? "default";
                    const query = new URLSearchParams(search);
                    if (next === "default") query.delete("sampleState"); else query.set("sampleState", next);
                    const qs = query.toString();
                    navigate(`/classes/${encodeURIComponent(id)}${qs ? `?${qs}` : ""}`, { replace: true });
                    setMessage(""); setGuide(false);
                  }} data-testid="select-sample-state">
                    {SAMPLE_STATES.map(s => <option key={s} value={s}>{SAMPLE_STATE_LABEL[s]}</option>)}
                  </select>
                </label>
              )}
              <dl className="dt-facts">
                <Fact label="날짜">{formatDateTime(item.scheduled_at).split(" ").slice(0, 3).join(" ")}</Fact>
                <Fact label="시간">{Number.isNaN(scheduledDate.getTime()) ? "일정 미정" : new Intl.DateTimeFormat("ko-KR", { hour: "numeric", minute: "2-digit" }).format(scheduledDate)}</Fact>
                <Fact label="소요 시간">{item.duration_minutes}분</Fact>
                <Fact label="가격" testid="class-price">{formatPrice(item.price)}{demo && item.price > 0 && <small>샘플 가격 · 실제 결제 없음</small>}</Fact>
                <Fact label="정원 / 잔여">총 {item.capacity}명 · 잔여 {item.remaining_slots}자리</Fact>
                <Fact label="연령 구간" testid="class-age-band">{ageBandLabel(item.age_band)}</Fact>
                <Fact label="참가 가능" testid="class-eligibility">{joinEligibilityLabel(item.age_band, session?.profile ? { birthYear: session.profile.birth_year, agePreference: session.profile.age_preference, isAdmin: session.profile.is_admin } : null)}</Fact>
                <Fact label="난이도" testid="class-difficulty" unknown={!meta}>{meta?.difficulty ?? unknownTxt}</Fact>
                <Fact label="초보자" testid="class-beginner" unknown={!meta} wide>{meta?.beginner ?? unknownTxt}</Fact>
                <Fact label="장소 · 집결지" wide>{item.gym.name}<small>{item.gym.address}</small><small>{extra ? extra.meetingPoint : "정확한 집결 위치는 미제공"}</small></Fact>
              </dl>
              {cap
                ? <CapacityDetail item={item} cap={cap} sample={sampleGender} onSample={g => { setSampleGender(g); setMessage(""); setGuide(false); }} />
                : <Card title="참가 현황" testid="section-attendance">
                  <p>총 {item.capacity}명 중 {item.participant_count}명 참가 · 잔여 {item.remaining_slots}자리</p>
                  <progress aria-label="전체 참가 현황" value={item.participant_count} max={Math.max(1, item.capacity)} style={{ width: "100%", accentColor: "var(--hb-sage)" }} />
                  <p className="dt-sub">개별 참가자 정보는 공개하지 않아요. 성별별 정원 정보는 미제공입니다.</p>
                </Card>}
              <Card title="이런 클래스예요">
                {extra ? extra.fullDescription.map(p => <p key={p}>{p}</p>) : <p>{item.description || UNKNOWN}</p>}
              </Card>
              <div data-testid="section-policies" style={{ display: "grid", gap: 12 }}>
                <Timeline steps={steps} total={item.duration_minutes} demo={demo} />
                <ListAccordion title="준비물" items={extra?.preparation} testid="toggle-gear" />
                <ListAccordion title="주의사항" items={extra?.cautions} testid="toggle-cautions" />
                <RefundAccordion text={meta?.refund} demo={demo} />
              </div>
              <Host host={extra?.host} />
              <PrivacyNote />
              {extra && <p className="dt-credit">샘플 이미지 출처: {extra.imageCredit}</p>}
              {!meta && <p className="dt-credit">환불 · 난이도 · 초보자 안내: {POLICY_UNKNOWN}</p>}
            </div>
            <DetailAction cta={cta} priceText={formatPrice(item.price)} remaining={item.remaining_slots} capacity={item.capacity} busy={busy}
              onJoin={() => { if (forcedDemo) navigate(`/preview/join?class=${encodeURIComponent(item.id)}&return=${encodeURIComponent(classHref)}`); else if (isUxDemoMode) setChooser(true); else void join(); }} message={message} guide={guide} onCloseNotice={() => { setMessage(""); setGuide(false); }}
              classHref={classHref} blindHref={item.is_joined && !demo ? `/blind/${item.id}` : undefined} demo={demo} />
          </div>
        </div>
        {isUxDemoMode && chooser && <JoinChooser onClose={() => setChooser(false)}
          onDemo={() => { setChooser(false); navigate(`/preview/join?class=${encodeURIComponent(item.id)}&return=${encodeURIComponent(classHref)}`); }}
          onReal={() => { setChooser(false); if (!session) navigate(classLoginUrl(classHref)); else void join(); }} />}
      </Shell>
    </div>
  );
}
