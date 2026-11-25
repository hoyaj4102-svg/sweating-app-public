import { useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { isUxDemoMode } from "@/explore/config";
import { PreviewUnavailable } from "@/explore/PreviewUnavailable";
import { DEMO_PEOPLE, getEligiblePeople, getMatches, getRevealQuote, getUnreadInterest } from "./demo-money";
import { DemoMoneyProvider, useDemo } from "./DemoContext";
import { findDemoClass } from "@/explore/demo-data";
import { DemoChatPage, DemoClassesPage, DemoDetailPage, RecoveryPanel } from "./DemoJourneyPages";
import { usePageMeta } from "./meta";
import { DEMO_NOTICE } from "./demo-enrollment";
import { DemoJoinPage, DemoJoinedPage } from "./DemoJoinPages";
import "./visual.css";
import "./journey-pages.css";

export { DemoMoneyProvider, useDemo };

type Person = (typeof DEMO_PEOPLE)[number];

const won = (n: number) => `${n.toLocaleString("ko-KR")} SWM`;
const KIND: Record<string, string> = { charge: "데모 충전", reveal: "관심 공개", super: "Super Like", like: "Like" };

export function DemoFrame({ Shell, page, title, children }: { Shell: ComponentType<{ children: ReactNode }>; page: string; title: string; children: ReactNode }) {
  const { state, enrollment, reset } = useDemo();
  const [, navigate] = useLocation();
  const [askReset, setAskReset] = useState(false);
  usePageMeta(`${title} | SWEATING 데모`, "SWEAT MONEY 수익화 UX를 실제 결제 없이 체험하는 개발용 데모 화면입니다.");
  const tabs: [string, string][] = [["classes", "클래스 선택"], ["workout", "운동 완료"], ["interests", "나에게 온 관심"], ["wallet", "지갑"]];
  return (
    <Shell>
      <div className="vv vv-demo" data-testid={`page-demo-${page}`}><div className="vv-w">
        <p style={{ paddingTop: 32 }}><span className="vv-badge" data-testid="badge-demo">DEMO / 실제 결제 없음 / 새로고침하면 초기화</span></p>
        <p className="vv-panel" role="note" data-testid="notice-development-demo">{DEMO_NOTICE}</p>
        <p className="vv-note" data-testid="text-memory-reset">새로고침하면 데모 상태가 초기화됩니다. 메모리에만 저장되며 저장소나 서버에는 남지 않습니다.</p>
        <h1 className="vv-h2" style={{ fontSize: "clamp(30px, 8vw, 52px)" }}>{title}</h1>
        {isUxDemoMode && <nav className="vv-dnav" aria-label="데모 참가 단계">
          <Link href={`/preview/join${enrollment ? `?class=${encodeURIComponent(enrollment.classId)}${enrollment.returnTo ? `&return=${encodeURIComponent(enrollment.returnTo)}` : ""}` : ""}`}>데모 참가 확인</Link>
          {enrollment?.joined && <Link href="/preview/joined">데모 참가 완료</Link>}
        </nav>}
        <div className="jr-reset"><button type="button" className="vv-sbtn" onClick={() => setAskReset(true)} data-testid="button-demo-reset">데모 처음부터 다시</button></div>
        {askReset && <ResetDialog onCancel={() => setAskReset(false)} onOk={() => { reset(); setAskReset(false); navigate("/preview/classes"); }} />}
        <nav className="vv-dnav" aria-label="데모 메뉴">{tabs.map(([k, l]) => <Link key={k} href={`/preview/${k}`} className={k === page ? "on" : ""}>{l}</Link>)}</nav>
        <div className="vv-bal"><span>데모 잔액</span><strong data-testid="text-balance">{won(state.balance)}</strong></div>
        {children}
        <p className="vv-note" style={{ paddingBottom: 40 }}>샘플 인물은 모두 가상입니다. 매치된 사람과의 채팅은 실제 서버 없이 시뮬레이션됩니다.</p>
      </div></div>
    </Shell>
  );
}
const Frame = DemoFrame;

function ResetDialog({ onOk, onCancel }: { onOk: () => void; onCancel: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const d = ref.current; d?.showModal(); return () => { if (d?.open) d.close(); }; }, []);
  return (
    <dialog ref={ref} className="vv-modal-bg" aria-label="데모 초기화" data-testid="modal-reset" onCancel={e => { e.preventDefault(); onCancel(); }}
      onKeyDown={e => {
        if (e.key !== "Tab") return;
        const c = [...e.currentTarget.querySelectorAll<HTMLElement>("button:not([disabled])")];
        const f = c[0], l = c[c.length - 1], a = document.activeElement;
        if ((e.shiftKey && a === f) || (!e.shiftKey && a === l) || a === e.currentTarget) { e.preventDefault(); (e.shiftKey ? l : f)?.focus(); }
      }}>
      <div className="vv-modal">
        <h2 style={{ fontSize: 20, margin: 0 }}>데모를 초기화할까요?</h2>
        <p className="vv-note" style={{ margin: 0 }}>참가, 좋아요, 매치, 채팅, 데모 잔액이 모두 사라지고 클래스 선택으로 돌아갑니다.</p>
        <div className="row">
          <button type="button" className="vv-sbtn" onClick={onCancel} data-testid="button-reset-cancel">취소</button>
          <button type="button" className="vv-sbtn fill" onClick={onOk} data-testid="button-reset-confirm">초기화</button>
        </div>
      </div>
    </dialog>
  );
}

type Confirm = { title: string; rows: [string, string][]; cost: number; credit?: number; onOk: () => void };
function ConfirmModal({ c, balance, onCancel }: { c: Confirm; balance: number; onCancel: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => { if (dialog?.open) dialog.close(); };
  }, []);
  const short = balance < c.cost;
  return (
    <dialog ref={dialogRef} className="vv-modal-bg" aria-label={c.title} onCancel={e => { e.preventDefault(); onCancel(); }}
      onKeyDown={e => {
        if (e.key !== "Tab") return;
        const controls = [...e.currentTarget.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter(el => el.getClientRects().length > 0);
        const first = controls[0], last = controls[controls.length - 1], active = document.activeElement;
        if ((e.shiftKey && active === first) || (!e.shiftKey && active === last) || active === e.currentTarget) {
          e.preventDefault();
          (e.shiftKey ? last : first)?.focus();
        }
      }} data-testid="modal-confirm">
      <div className="vv-modal">
        <h2 style={{ fontSize: 20, margin: 0 }}>{c.title}</h2>
        <dl>
          {c.rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
          <div><dt>차감 금액</dt><dd>{won(c.cost)}</dd></div>
          <div><dt>현재 잔액</dt><dd>{won(balance)}</dd></div>
          <div><dt>{c.credit ? "충전 후 데모 잔액" : "차감 후 잔액"}</dt><dd>{short ? "잔액 부족" : won(balance - c.cost + (c.credit ?? 0))}</dd></div>
        </dl>
        {short && <p className="vv-err" role="alert" data-testid="text-insufficient">잔액이 부족해요. <Link href="/preview/wallet" style={{ textDecoration: "underline" }}>지갑에서 데모 충전하기</Link></p>}
        <p className="vv-note" style={{ margin: 0 }}>데모입니다. 실제 결제나 금전 거래는 없습니다.</p>
        <div className="row">
          <button type="button" className="vv-sbtn" onClick={onCancel} data-testid="button-modal-cancel">취소</button>
          <button type="button" className="vv-sbtn fill" disabled={short} onClick={c.onOk} data-testid="button-modal-confirm">확인</button>
        </div>
      </div>
    </dialog>
  );
}

function useConfirm() {
  const [c, setC] = useState<Confirm | null>(null);
  const { state } = useDemo();
  const modal = c ? <ConfirmModal c={c} balance={state.balance} onCancel={() => setC(null)} /> : null;
  return { open: (x: Confirm) => setC(x), close: () => setC(null), modal };
}

function WorkoutPage({ Shell }: { Shell: ComponentType<{ children: ReactNode }> }) {
  const { state, enrollment, workoutStarted, startWorkout, complete, spend, like } = useDemo();
  const cf = useConfirm();
  const [notice, setNotice] = useState("");
  const people = state.completed ? getEligiblePeople(state) : [];
  const matchIds = new Set(getMatches(state).map(m => m.id));
  const superTo = (p: Person) => cf.open({
    title: "Super Like 보내기", rows: [["구매 기능", "Super Like"], ["대상", `${p.name}, ${p.age}`]], cost: 2000,
    onOk: () => { const r = spend("super", [p.id]); cf.close(); setNotice(r.ok ? "특별 관심을 보냈어요(데모). 상대가 동의해야 매치됩니다." : "Super Like를 보내지 못했어요."); },
  });
  return (
    <Frame Shell={Shell} page="workout" title="운동 완료 데모">
      {!enrollment?.joined ? <RecoveryPanel /> : <>
      {!workoutStarted && !state.completed && <div className="vv-panel" data-testid="state-before-workout"><strong>운동 전에는 참가자 프로필이 비공개예요.</strong><p style={{ margin: 0 }}>운동을 시작하고 마치면 같은 클래스에서 함께한 사람만 확인할 수 있어요.</p>
        <button type="button" className="vv-sbtn fill" onClick={() => startWorkout()} data-testid="button-start-workout">운동 시작 (데모)</button></div>}
      {workoutStarted && !state.completed && <div className="vv-panel" data-testid="state-workout-running"><strong>운동 중이에요 (데모)</strong><p style={{ margin: 0 }}>프로필은 아직 비공개입니다.</p>
        <button type="button" className="vv-sbtn fill" onClick={() => { complete(true); setNotice(""); }} data-testid="button-complete-workout">운동 완료 (데모)</button></div>}
      {state.completed && <>
          {notice && <p className="vv-ok" role="status" data-testid="text-notice">{notice}</p>}
          <div className="vv-panel"><strong>함께 운동한 참가자 (가상 인물)</strong>
            <p data-testid="text-roster-class">선택한 가상 클래스: {enrollment ? findDemoClass(enrollment.classId)?.item.title : ""}. 아래 인물은 이 클래스의 가상 참가자이며, 종목은 개인 취향입니다.</p>
            {people.length ? people.map(p => {
              const sent = state.superLiked.includes(p.id);
              const liked = state.liked.includes(p.id);
              return (
                <div className="vv-person" key={p.id} data-testid={`card-person-${p.id}`} data-demo-class={p.classId}>
                  <div><strong>{p.name}, {p.age}</strong><p>{p.sport} · {p.bio}</p>{matchIds.has(p.id) && <p data-testid={`text-match-${p.id}`}>서로 Like — 매치됐어요. <Link href={`/preview/chat?person=${p.id}`} className="jr-link" data-testid={`link-chat-${p.id}`}>채팅하기</Link></p>}</div>
                  <div style={{ display: "grid", gap: 6 }}>
                    <button type="button" className="vv-sbtn" disabled={liked} onClick={() => { const r = like(p.id); setNotice(r.ok && r.state.liked.includes(p.id) && getMatches(r.state).some(m => m.id === p.id) ? "서로 Like가 되어 매치됐어요(데모)." : r.ok ? "Like를 보냈어요(데모)." : "Like를 보내지 못했어요."); }} data-testid={`button-like-${p.id}`}>{liked ? "Like 완료" : "Like (무료)"}</button>
                    <button type="button" className="vv-sbtn fill" disabled={sent} onClick={() => superTo(p)} data-testid={`button-super-${p.id}`}>{sent ? "Super Like 전송됨" : "Super Like 2,000 SWM"}</button>
                  </div>
                </div>
              );
            }) : <p>공개할 참가자가 없어요.</p>}
          </div>
          <p><Link href="/preview/interests" className="vv-sbtn" style={{ display: "inline-flex", alignItems: "center" }}>나에게 온 관심 보기</Link>{" "}<Link href="/preview/wallet" className="vv-sbtn" style={{ display: "inline-flex", alignItems: "center" }}>지갑</Link></p>
      </>}
      </>}
      {cf.modal}
    </Frame>
  );
}

function InterestsPage({ Shell }: { Shell: ComponentType<{ children: ReactNode }> }) {
  const { state, enrollment, spend, like } = useDemo();
  const cf = useConfirm();
  const [notice, setNotice] = useState("");
  const unread = state.completed ? getUnreadInterest(state) : [];
  const matches = state.completed ? getMatches(state) : [];
  const matchIds = new Set(matches.map(m => m.id));
  const revealed = state.completed ? getEligiblePeople(state).filter(p => state.revealed.includes(p.id) && !matchIds.has(p.id)) : [];
  const interestCount = unread.length + revealed.length;
  const reveal = (ids: string[], label: string) => {
    const q = getRevealQuote(state, ids);
    cf.open({
      title: "관심 공개", rows: [["구매 기능", "Who Likes Me"], ["공개 인원", label]], cost: q.cost,
      onOk: () => { const r = spend("reveal", q.ids); cf.close(); setNotice(r.ok ? `${q.ids.length}명의 프로필을 공개했어요(데모).` : "공개하지 못했어요."); },
    });
  };
  const all = getRevealQuote(state);
  return (
    <Frame Shell={Shell} page="interests" title="나에게 온 관심">
      {notice && <p className="vv-ok" role="status" data-testid="text-notice">{notice}</p>}
      {!enrollment?.joined ? <RecoveryPanel /> : !state.completed ? (
        <div className="vv-panel" data-testid="state-before-workout"><strong>운동 완료 후에 확인할 수 있어요.</strong><Link href="/preview/workout" className="vv-sbtn" style={{ display: "inline-flex", alignItems: "center", width: "fit-content" }}>운동 완료 데모로 이동</Link></div>
      ) : (
        <>
          {interestCount > 0 && <p style={{ fontSize: 18, fontWeight: 700 }} data-testid="text-interest-count">{interestCount}명이 당신에게 관심을 보냈어요. <small>미열람 {unread.length}명</small></p>}
          {unread.length > 0 && <>
            <div className="vv-ghosts">{unread.map((p, i) => (
              <div className="vv-ghost" key={p.id} data-testid="card-hidden-interest">
                <span>비공개 관심 {i + 1}</span>
                <button type="button" className="vv-sbtn" onClick={() => reveal([p.id], "1명")} data-testid={`button-reveal-one-${i}`}>공개 2,000 SWM</button>
              </div>
            ))}</div>
            <button type="button" className="vv-sbtn fill" style={{ width: "100%", marginTop: 12 }} onClick={() => reveal(all.ids, `${all.ids.length}명`)} data-testid="button-reveal-all">{all.ids.length}명 모두 확인하기 — {won(all.cost)}</button>
          </>}
          {unread.length === 0 && revealed.length === 0 && <p className="vv-panel">새로 도착한 관심이 없어요.</p>}
          {revealed.length > 0 && <div className="vv-panel"><strong>공개된 프로필 (다시 열어도 무료)</strong>
            {revealed.map(p => {
              const liked = state.liked.includes(p.id);
              return (
                <div className="vv-person" key={p.id} data-testid={`card-revealed-${p.id}`}>
                  <div><strong>{p.name}, {p.age}</strong><p>{p.sport} · {p.bio}</p></div>
                  <button type="button" className="vv-sbtn fill" disabled={liked} onClick={() => { like(p.id); setNotice("서로 관심이 있어 무료 매치가 됐어요(샘플)."); }} data-testid={`button-like-${p.id}`}>{liked ? "Like 완료" : "Like (무료)"}</button>
                </div>
              );
            })}
          </div>}
          {matches.length > 0 && <div className="vv-panel" data-testid="list-matches"><strong>무료 매치 (샘플)</strong>
            {matches.map(p => <div className="vv-person" key={p.id}><div><strong>{p.name}, {p.age}</strong><p><Link href={`/preview/chat?person=${p.id}`} className="jr-link" data-testid={`link-chat-${p.id}`}>채팅하기 (데모)</Link></p></div></div>)}
          </div>}
        </>
      )}
      {cf.modal}
    </Frame>
  );
}

const AMOUNTS = [3000, 5000, 10000, 20000];
function WalletPage({ Shell }: { Shell: ComponentType<{ children: ReactNode }> }) {
  const { state, enrollment, topUp } = useDemo();
  const cf = useConfirm();
  const [notice, setNotice] = useState("");
  return (
    <Frame Shell={Shell} page="wallet" title="SWEAT MONEY 지갑">
      {!enrollment?.joined ? <RecoveryPanel /> : <>
      <p className="vv-note">1 SWM = 1원 (기획 기준). 데모 충전만 가능하며 실제 결제는 발생하지 않습니다.</p>
      {notice && <p className="vv-ok" role="status" data-testid="text-notice">{notice}</p>}
      {state.balance < 2000 && <p className="vv-err" data-testid="text-low-balance">잔액이 2,000 SWM 미만이에요. Super Like와 관심 공개에 충전이 필요해요.</p>}
      <div className="vv-amounts">{AMOUNTS.map(a => (
        <button key={a} type="button" className="vv-sbtn" style={{ minHeight: 56 }} data-testid={`button-topup-${a}`}
          onClick={() => cf.open({ title: "데모 충전", rows: [["구매 기능", "SWEAT MONEY 데모 충전"], ["충전 금액", won(a)]], cost: 0, credit: a, onOk: () => { const r = topUp(a); cf.close(); setNotice(r.ok ? `${won(a)}을 데모 충전했어요.` : "충전하지 못했어요."); } })}>{won(a)}</button>
      ))}</div>
      <div className="vv-panel"><strong>이용 내역</strong>
        {state.history.length ? <ul className="vv-hist" data-testid="list-history">{state.history.map(h => <li key={h.id}><span>{KIND[h.kind] ?? h.kind}{h.count > 1 ? ` ${h.count}건` : ""}</span><b>{h.amount > 0 ? "+" : ""}{h.amount.toLocaleString("ko-KR")} SWM</b></li>)}</ul> : <p style={{ margin: 0 }}>아직 이용 내역이 없어요.</p>}
      </div>
      </>}
      {cf.modal}
    </Frame>
  );
}

const PAGES = ["classes", "detail", "join", "joined", "workout", "interests", "wallet", "chat"];
/** Provider is mounted once at the app root so memory state survives route changes. */
export function DemoSurface({ page, Shell, Fallback }: { page: string; Shell: ComponentType<{ children: ReactNode }>; Fallback: ComponentType }) {
  if (!isUxDemoMode || !PAGES.includes(page)) {
    return isUxDemoMode ? <Fallback /> : <Shell><PreviewUnavailable feature="개발용 UX 데모" hideActions /></Shell>;
  }
  return page === "classes" ? <DemoClassesPage Shell={Shell} /> : page === "detail" ? <DemoDetailPage Shell={Shell} /> : page === "chat" ? <DemoChatPage Shell={Shell} />
    : page === "join" ? <DemoJoinPage Shell={Shell} /> : page === "joined" ? <DemoJoinedPage Shell={Shell} /> : page === "workout" ? <WorkoutPage Shell={Shell} /> : page === "wallet" ? <WalletPage Shell={Shell} /> : <InterestsPage Shell={Shell} />;
}
