import { Link } from "wouter";
import { ArrowUpRight } from "lucide-react";
import { classLoginUrl } from "./auth-return";
import type { CtaState } from "./detail-state";

type Props = {
  cta: CtaState; priceText: string; remaining: number; capacity: number; busy: boolean;
  onJoin: () => void; message: string; guide: boolean; onCloseNotice: () => void;
  classHref: string; blindHref?: string; demo: boolean;
};

export function DetailAction({ cta, priceText, remaining, capacity, busy, onJoin, message, guide, onCloseNotice, classHref, blindHref, demo }: Props) {
  return (
    <aside className="dt-action" aria-label="참가 신청" data-testid="panel-detail-action">
      {message && (
        <div className="dt-panel" role={guide ? "dialog" : "status"} aria-label={guide ? "로그인 안내" : "안내"} data-testid={guide ? "panel-login-guide" : "panel-notice"}>
          <div className="dt-panel-head"><span>{guide ? "로그인이 필요해요" : "안내"}</span><button type="button" onClick={onCloseNotice} data-testid="button-close-notice">닫기</button></div>
          <span>{message}</span>
          {guide && <div className="dt-panel-links"><Link href={classLoginUrl(classHref)} className="dt-link" data-testid="link-login">로그인</Link><Link href="/signup" className="dt-link" data-testid="link-signup">가입하기</Link></div>}
        </div>
      )}
      <div className="dt-action-row">
        <div className="dt-price"><b data-testid="text-price">{priceText}</b><small>1인 기준 · 잔여 {remaining}자리 / 총 {capacity}명</small></div>
        <button type="button" className="dt-cta" onClick={onJoin} disabled={busy || cta.disabled} data-testid="button-join-class">{busy ? "신청 중…" : cta.label}{!cta.disabled && <ArrowUpRight size={16} />}</button>
      </div>
      {(cta.kind === "joined" || cta.kind === "completed") && blindHref && <Link href={blindHref} className="dt-link" data-testid="link-blind">{cta.kind === "completed" ? "운동 후 참가자 보기" : "Blind Workout 보기"}</Link>}
      {demo && <small className="dt-price">샘플 화면 · 실제 결제와 신청은 진행되지 않아요.</small>}
    </aside>
  );
}
