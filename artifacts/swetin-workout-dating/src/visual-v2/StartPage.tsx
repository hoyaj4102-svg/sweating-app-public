import type { ComponentType, ReactNode } from "react";
import { Link } from "wouter";
import { useSearch } from "wouter/use-browser-location";
import { withCampaign } from "./campaign";
import { usePageMeta } from "./meta";
import "./visual.css";

export function StartPage({ Shell }: { Shell: ComponentType<{ children: ReactNode }> }) {
  const search = useSearch();
  usePageMeta("시작하기 | SWEATING", "일반 회원으로 시작하거나 체육관 파트너로 제휴를 신청하세요.");
  return (
    <Shell>
      <div className="vv vv-start" data-testid="page-start"><div className="vv-w">
        <p className="vv-eyebrow">START / MOVE TO MEET.</p>
        <h1 className="vv-h2">어떻게 시작할까요?</h1>
        <div className="vv-choice">
          <div>
            <h2>운동하고, 좋은 사람 만나기</h2>
            <p>함께 운동하고 자연스럽게 새로운 인연을 만나보세요.</p>
            <Link href={withCampaign("/signup", search)} className="vv-btn dark" data-testid="link-start-member">일반 회원으로 시작하기</Link>
          </div>
          <div>
            <h2>우리 체육관에 새로운 고객 만나기</h2>
            <p>운동 클래스를 열고 새로운 고객을 만나보세요.</p>
            <Link href={withCampaign("/partners", search)} className="vv-btn" data-testid="link-start-partner">체육관 제휴 신청하기</Link>
          </div>
        </div>
        <p className="vv-note"><Link href="/login" data-testid="link-start-login">이미 계정이 있으신가요? 로그인</Link></p>
      </div></div>
    </Shell>
  );
}
