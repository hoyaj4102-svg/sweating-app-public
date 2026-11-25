import { type ComponentType, type FormEvent, type ReactNode, useState } from "react";
import { Link, useLocation } from "wouter";
import { useSearch } from "wouter/use-browser-location";
import { formatDateTime, formatPrice } from "@/explore/config";
import { ClassDetailPage } from "@/explore/ClassDetailPage";
import { listDemoClasses } from "@/explore/demo-data";
import { DemoFrame } from "./DemoPages";
import { useDemo } from "./DemoContext";
import { getMatches, getEligiblePeople } from "./demo-money";
import { DEFAULT_DEMO_CLASS_ID, DEMO_NOTICE } from "./demo-enrollment";

type ShellProps = { Shell: ComponentType<{ children: ReactNode }> };

export function RecoveryPanel() {
  return (
    <div className="vv-panel" role="status" data-testid="state-demo-recovery">
      <strong>데모 상태가 없어요.</strong>
      <p style={{ margin: 0 }}>새로고침하면 데모 상태가 초기화됩니다. 클래스를 다시 선택하고 참가를 확정해 주세요.</p>
      <Link href="/preview/classes" className="jr-btn fill" data-testid="link-demo-recovery">클래스 선택으로 이동</Link>
    </div>
  );
}

export function DemoClassesPage({ Shell }: ShellProps) {
  const { selectClass } = useDemo();
  const [, navigate] = useLocation();
  const list = listDemoClasses();
  return (
    <DemoFrame Shell={Shell} page="classes" title="가상 클래스 선택">
      <div className="jr-grid" data-testid="list-demo-classes">
        {list.map(({ item }) => (
          <section className="jr-card" key={item.id} data-testid={`card-demo-class-${item.id}`}>
            <h2>{item.title}</h2>
            <p>{item.sport_type} · {formatDateTime(item.scheduled_at)} · {formatPrice(item.price)}</p>
            <button type="button" className="jr-btn fill" data-testid={`button-select-class-${item.id}`}
              onClick={() => { const to = `/preview/detail?class=${encodeURIComponent(item.id)}`; selectClass(item.id, to); navigate(to); }}>이 클래스 보기</button>
          </section>
        ))}
      </div>
    </DemoFrame>
  );
}

export function DemoDetailPage({ Shell }: ShellProps) {
  const q = new URLSearchParams(useSearch());
  const raw = q.get("class");
  const id = raw && raw.startsWith("demo-") ? raw : DEFAULT_DEMO_CLASS_ID;
  const banner = (
    <div className="jr-banner" data-testid="banner-demo-detail">
      <b>{DEMO_NOTICE}</b>
      <span>새로고침하면 데모 상태가 초기화됩니다.</span>
      <Link href="/preview/classes" className="jr-link" data-testid="link-demo-recovery">클래스 선택으로 이동</Link>
    </div>
  );
  return <ClassDetailPage id={id} Shell={Shell} session={null} demoOnly demoBanner={banner} />;
}

export function DemoChatPage({ Shell }: ShellProps) {
  const q = new URLSearchParams(useSearch());
  const pid = q.get("person") ?? "";
  const { state, enrollment, messages, sendMessage } = useDemo();
  const [text, setText] = useState("");
  const [err, setErr] = useState("");
  const person = getEligiblePeople(state).find(p => p.id === pid);
  const allowed = !!enrollment?.joined && state.completed && !!person && getMatches(state).some(m => m.id === pid);
  const list = messages[pid] ?? [];
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) { setErr("메시지를 입력해 주세요."); return; }
    setErr("");
    if (sendMessage(pid, t)) setText("");
    else setErr("메시지를 보내지 못했어요.");
  };
  return (
    <DemoFrame Shell={Shell} page="chat" title="매치 채팅 (시뮬레이션)">
      {!enrollment?.joined ? <RecoveryPanel /> : !allowed ? (
        <div className="vv-panel" data-testid="state-chat-blocked"><strong>서로 Like한 매치 상대만 채팅할 수 있어요.</strong>
          <Link href="/preview/workout" className="jr-btn" data-testid="link-chat-back">운동 단계로 이동</Link></div>
      ) : (
        <div className="vv-panel" data-testid="panel-demo-chat">
          <strong>{person?.name}와의 채팅</strong>
          <p className="vv-note" style={{ margin: 0 }}>데모 채팅입니다. 실제 전송 없이 자동 답장이 표시됩니다.</p>
          <div className="jr-chat" data-testid="list-chat-messages">
            {list.length === 0 && <p>첫 메시지를 보내 보세요.</p>}
            {list.map(m => <div key={m.id} className={`jr-msg ${m.author}`} data-testid={`message-${m.author}-${m.id}`}>{m.author === "demo" && <small>데모 자동 답장</small>}{m.text}</div>)}
          </div>
          <form className="jr-form" onSubmit={submit}>
            <input value={text} onChange={e => setText(e.target.value)} maxLength={200} aria-label="메시지" data-testid="input-chat-message" />
            <button type="submit" className="jr-btn fill" data-testid="button-send-message">보내기</button>
          </form>
          {err && <p className="vv-err" role="alert">{err}</p>}
        </div>
      )}
    </DemoFrame>
  );
}
