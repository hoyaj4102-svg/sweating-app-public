import type { ReactNode } from "react";
import { ShieldCheck } from "lucide-react";
import type { ProgramStep } from "./programs";
import { POLICY_UNKNOWN, UNKNOWN } from "./detail-content";

export function Fact({ label, children, wide, testid, unknown }: { label: string; children: ReactNode; wide?: boolean; testid?: string; unknown?: boolean }) {
  return <div className={`dt-fact ${wide ? "wide" : ""}`}><dt>{label}</dt><dd className={unknown ? "dt-unknown" : ""} data-testid={testid}>{children}</dd></div>;
}

export function Card({ title, children, testid }: { title: string; children: ReactNode; testid?: string }) {
  return <section className="dt-card" data-testid={testid}><h2>{title}</h2>{children}</section>;
}

function Accordion({ title, children, open, testid }: { title: string; children: ReactNode; open?: boolean; testid: string }) {
  return <details className="dt-acc" open={open} data-testid={testid}><summary>{title}</summary><div className="dt-acc-body">{children}</div></details>;
}

export function Timeline({ steps, total, demo }: { steps?: ProgramStep[]; total: number; demo: boolean }) {
  let at = 0;
  return (
    <Accordion title="진행 순서" open testid="toggle-timeline">
      {steps ? <>
        <p className="dt-sub">{demo ? "샘플 클래스의 가상 구성이에요." : "클래스명 기반 일러스트 구성이며 공식 운영 안내가 아닙니다."}</p>
        <ol className="dt-tl">{steps.map(s => { const a = at; at += s.minutes; return <li key={s.title}><time>{a}–{at}분</time><div><h3>{s.title}</h3><p>{s.description}</p></div></li>; })}</ol>
        <div className="dt-tl-total"><span>총 소요</span><span>{at}분</span></div>
      </> : <p>{UNKNOWN} (총 소요 {total}분)</p>}
    </Accordion>
  );
}

export function ListAccordion({ title, items, testid }: { title: string; items?: string[]; testid: string }) {
  return <Accordion title={title} testid={testid}>{items?.length ? <ul className="dt-list">{items.map(x => <li key={x}>{x}</li>)}</ul> : <p className="dt-unknown">{UNKNOWN}</p>}</Accordion>;
}

export function RefundAccordion({ text, demo }: { text?: string; demo: boolean }) {
  return (
    <Accordion title="취소 및 환불 정책" testid="toggle-cancellation">
      <p data-testid="text-refund">{text ?? POLICY_UNKNOWN}</p>
      {demo && <p className="dt-sub">샘플 가정 문구예요. 실제 결제는 없습니다.</p>}
      {!text && <p className="dt-sub">운영자의 정책이 확인되기 전까지 환불 여부를 단정하지 않아요.</p>}
    </Accordion>
  );
}

export function Host({ host }: { host?: { name: string; role: string; bio: string } }) {
  return (
    <Card title="호스트 · 장소 소개" testid="section-host">
      {host ? <div className="dt-host"><span className="dt-host-mark">{host.name.slice(-1)}</span><div><strong>{host.name}</strong><p className="dt-sub">{host.role}</p><p>{host.bio}</p></div></div> : <p className="dt-unknown">{UNKNOWN}</p>}
    </Card>
  );
}

export function PrivacyNote() {
  return <p className="dt-privacy" data-testid="text-privacy"><ShieldCheck size={16} /><span>참가자 수만 보여드려요. 수업 전에는 다른 참가자의 이름, 사진, 프로필을 볼 수 없어요.</span></p>;
}
