import { useEffect, useMemo, type ComponentType, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useSearch } from "wouter/use-browser-location";
import { formatDateTime, formatPrice } from "@/explore/config";
import { findDemoClass } from "@/explore/demo-data";
import { DemoFrame } from "./DemoPages";
import { useDemo } from "./DemoContext";
import { DEFAULT_DEMO_CLASS_ID, DEMO_NOTICE, safeDemoReturn } from "./demo-enrollment";
import "./demo-join.css";

type ShellProps = { Shell: ComponentType<{ children: ReactNode }> };
const resolve = (raw: string | null) => {
  const hit = raw && raw.startsWith("demo-") ? findDemoClass(raw) : undefined;
  const found = hit ?? findDemoClass(DEFAULT_DEMO_CLASS_ID);
  return { demo: found, fallback: !hit };
};

export function DemoJoinPage({ Shell }: ShellProps) {
  const search = useSearch();
  const [, navigate] = useLocation();
  const { selectClass, joinDemo, enrollment } = useDemo();
  const q = useMemo(() => new URLSearchParams(search), [search]);
  const ret = safeDemoReturn(q.get("return"));
  const { demo, fallback } = resolve(q.get("class"));
  const id = demo?.item.id ?? DEFAULT_DEMO_CLASS_ID;
  useEffect(() => { selectClass(id, ret); }, [id, ret, selectClass]);
  const ready = enrollment?.classId === id && enrollment.returnTo === ret;
  const item = demo?.item;
  return (
    <DemoFrame Shell={Shell} page="join" title="데모 참가 확인">
      <div className="dj" data-testid="page-demo-join">
        <p className="dj-warn" role="note" data-testid="text-demo-notice">{DEMO_NOTICE}</p>
        {fallback && <p className="dj-warn" data-testid="text-demo-fallback">요청한 클래스는 데모에 없어서 가상 클래스로 대체했어요.</p>}
        {item && <section className="dj-card" data-testid="card-demo-class">
          <h2>{item.title}</h2>
          <dl>
            <div><dt>종목</dt><dd>{item.sport_type}</dd></div>
            <div><dt>일정</dt><dd>{formatDateTime(item.scheduled_at)}</dd></div>
            <div><dt>가상 가격</dt><dd>{formatPrice(item.price)} (표시용, 청구 없음)</dd></div>
          </dl>
        </section>}
        <div className="dj-row">
          <button type="button" className="dj-btn fill" disabled={!ready || !item} data-testid="button-confirm-demo-join" onClick={() => { joinDemo(); navigate("/preview/joined"); }}>데모 참가 확정</button>
          <button type="button" className="dj-btn" data-testid="button-cancel-demo-join" onClick={() => navigate(ret ?? "/home")}>취소</button>
        </div>
      </div>
    </DemoFrame>
  );
}

export function DemoJoinedPage({ Shell }: ShellProps) {
  const { enrollment } = useDemo();
  const joined = !!enrollment?.joined;
  const demo = enrollment ? findDemoClass(enrollment.classId) : undefined;
  return (
    <DemoFrame Shell={Shell} page="joined" title={joined ? "데모 참가 완료" : "아직 확정되지 않았어요"}>
      <div className="dj" data-testid="page-demo-joined">
        <p className="dj-warn" role="note" data-testid="text-demo-notice">{DEMO_NOTICE}</p>
        {joined ? <>
          <p className="dj-warn" role="status" data-testid="text-demo-joined">데모 참가 완료 — 실제 예약은 생성되지 않았습니다.</p>
          {demo && <section className="dj-card"><h2>{demo.item.title}</h2><p style={{ margin: 0 }}>{demo.item.sport_type} · {formatDateTime(demo.item.scheduled_at)}</p></section>}
          <section className="dj-card" data-testid="state-blind-private">
            <h2>Blind Workout</h2>
            <p style={{ margin: 0 }}>운동 전에는 참가자 프로필이 비공개예요. 운동을 마치면 함께한 가상 인물이 공개됩니다.</p>
          </section>
          <div className="dj-row"><Link href="/preview/workout" className="dj-btn fill" data-testid="link-demo-workout">운동 완료 체험하기</Link></div>
        </> : <section className="dj-card" data-testid="state-not-confirmed">
          <p style={{ margin: 0 }}>참가가 아직 확정되지 않았어요.</p>
          <p>새로고침하면 데모 상태가 초기화됩니다. 클래스를 다시 선택해 주세요.</p>
          <div className="dj-row"><Link href="/preview/classes" className="dj-btn fill" data-testid="link-demo-recovery">클래스 선택으로 이동</Link></div>
        </section>}
      </div>
    </DemoFrame>
  );
}
