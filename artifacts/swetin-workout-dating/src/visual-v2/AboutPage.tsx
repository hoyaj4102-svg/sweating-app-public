import type { ComponentType, ReactNode } from "react";
import { Link } from "wouter";
import { useSearch } from "wouter/use-browser-location";
import { ArrowRight } from "lucide-react";
import { HOME_CATEGORIES, buildHomeUrl } from "@/explore/home-filters";
import { withCampaign } from "./campaign";
import { usePageMeta } from "./meta";
import heroRunner from "../assets/brand/running-together.jpg";
import cityRun from "../assets/brand/running-city.jpg";
import coffee from "../../attached_assets/generated_images/coffee-meet.jpg";
import boxing from "../../attached_assets/generated_images/boxing-pair.jpg";
import "./visual.css";

const STEPS = [
  ["STEP 01", "FIND A CLASS", "마음에 드는 운동 클래스를 선택하세요."],
  ["STEP 02", "WORK OUT TOGETHER", "처음에는 프로필보다 함께하는 운동에 집중합니다."],
  ["STEP 03", "DISCOVER", "수업이 끝나면 함께 운동한 참가자들의 프로필을 확인할 수 있습니다."],
  ["STEP 04", "LIKE & MATCH", "관심을 표현하고 서로 마음이 통하면 매칭됩니다."],
  ["STEP 05", "COFFEE CHAT", "운동에서 시작된 인연을 커피 한 잔으로 이어가세요. (향후 제공 예정, 현재 채팅 기능은 없습니다.)"],
];
const CARDS = [
  ["REAL EXPERIENCE", "사진보다 먼저, 실제로 함께하는 경험."],
  ["NATURAL CONNECTION", "어색한 소개팅 대신, 공통의 활동에서 시작하는 대화."],
  ["MUTUAL CHOICE", "일방적인 접근이 아닌, 서로 관심이 있을 때 이어지는 관계."],
];
const SPORTS = ["러닝", "복싱", "요가", "클라이밍", "테니스"].filter(s => HOME_CATEGORIES.includes(s));

export function AboutPage({ Shell }: { Shell: ComponentType<{ children: ReactNode }> }) {
  const search = useSearch();
  usePageMeta("SWEATING 소개 | 소개팅 말고, 같이 sweating 할래요?", "운동으로 시작하는 새로운 데이팅. 함께 운동한 뒤에 프로필을 확인하는 SWEATING을 소개합니다.");
  const all = withCampaign("/home", search);
  const sportHref = (sport: string) => withCampaign(buildHomeUrl({ sport, q: "", view: "list", open: false, free: false }), search);
  return (
    <Shell>
      <div className="vv vv-about" data-testid="page-about">
        <section className="vv-hero">
          <img src={heroRunner} alt="함께 달리는 남녀" fetchPriority="high" />
          <div className="vv-hero-copy">
            <p className="vv-eyebrow">SWEATING / MOVE TO MEET.</p>
            <h1><span className="cm-l">소개팅 말고,</span><b className="cm-l">같이 sweating 할래요?</b></h1>
            <p className="vv-sub" data-testid="text-about-subtitle">소개팅 말고, 같이 뛸래요?</p>
            <p className="vv-sub">운동으로 시작하는 새로운 데이팅.</p>
            <p className="vv-desc">사진 몇 장으로 서로를 판단하기보다, 함께 움직이고 대화하며 자연스럽게 알아가는 만남을 제안합니다.</p>
            <Link href={all} className="vv-btn" data-testid="link-about-hero-cta">운동 클래스 둘러보기 <ArrowRight size={18} /></Link>
          </div>
        </section>
        <section className="vv-sec"><div className="vv-w">
          <p className="vv-eyebrow">WHY SWEATING?</p>
          <h2 className="vv-h2">사람을 알아가는 데,<br />프로필만으로 충분할까요?</h2>
          <img className="cm-photo" src={cityRun} alt="벽돌 건물 옆을 함께 달리는 남녀" loading="lazy" />
          <div className="vv-body">
            <p>직업, 학력, 외모, 짧은 자기소개.</p>
            <p>우리는 누군가를 만나기 전에 수많은 조건을 확인합니다.</p>
            <p>하지만 함께 움직이는 시간 속에서는 다른 모습이 보입니다.</p>
            <p>서로를 배려하는 태도, 대화하는 방식, 작은 순간의 자연스러움.</p>
            <p>SWEATING은 조건보다 함께하는 경험에서 시작하는 만남을 제안합니다.</p>
          </div>
        </div></section>
        <section className="vv-sec alt"><div className="vv-w">
          <p className="vv-eyebrow">HOW IT WORKS</p>
          <h2 className="vv-h2">먼저 운동하고,<br />그다음 알아갑니다.</h2>
          <ol className="vv-steps">{STEPS.map(([n, t, d]) => <li className="vv-step" key={n}><small>{n}</small><h3>{t}</h3><p>{d}</p></li>)}</ol>
        </div></section>
        <section className="vv-sec"><div className="vv-w">
          <p className="vv-eyebrow">OUR DIFFERENCE</p>
          <h2 className="vv-h2">스와이프보다,<br />함께한 한 시간.</h2>
          <div className="vv-cards">{CARDS.map(([t, d]) => <div className="vv-card" key={t}><h3>{t}</h3><p>{d}</p></div>)}</div>
        </div></section>
        <section className="vv-sec alt"><div className="vv-w">
          <p className="vv-eyebrow">FIND YOUR CLASS</p>
          <h2 className="vv-h2">당신은 어떤 운동을<br />좋아하나요?</h2>
          <div className="vv-sports">{SPORTS.map(s => <Link key={s} href={sportHref(s)} className="vv-sport" data-testid={`link-about-sport-${s}`}>{s}<ArrowRight size={16} /></Link>)}</div>
          <p style={{ marginTop: 26 }}><Link href={all} className="vv-btn dark" data-testid="link-about-all">전체 클래스 둘러보기 <ArrowRight size={18} /></Link></p>
        </div></section>
        <section className="vv-sec dark vv-partner-teaser"><div className="vv-w vv-gym">
          <div>
            <p className="vv-eyebrow" style={{ color: "rgba(247,247,245,.6)" }}>GYM PARTNERS</p>
            <h2 className="vv-h2">당신의 체육관이,<br />새로운 만남의 장소가 됩니다.</h2>
            <div className="vv-body">
              <p>SWEATING은 체육관과 함께합니다.</p>
              <p>체육관 운영자는 기존 시설과 프로그램을 활용해 새로운 만남을 위한 소규모 운동 클래스를 개설할 수 있습니다.</p>
              <p>새로운 고객을 만나고, 클래스 수익과 정규 회원 전환의 기회를 만들어 보세요.</p>
            </div>
            <p style={{ marginTop: 24 }}><Link href={withCampaign("/partners", search)} className="vv-btn" data-testid="link-about-partners">파트너 체육관 알아보기 <ArrowRight size={18} /></Link></p>
          </div>
          <img src={boxing} alt="체육관에서 함께 운동하는 두 사람" loading="lazy" />
        </div></section>
        <section className="vv-final">
          <img src={coffee} alt="" loading="lazy" />
          <div className="vv-w">
            <h2 className="vv-h2">인연이 아니어도,<br />좋은 경험은 남으니까.</h2>
            <p className="vv-sub">함께 운동하는 즐거움부터 시작해 보세요.</p>
            <Link href={all} className="vv-btn" data-testid="link-about-final">지금 클래스 찾기 <ArrowRight size={18} /></Link>
          </div>
        </section>
        <div className="vv-w vv-foot"><span>SWEATING / MOVE TO MEET.</span><Link href={withCampaign("/partners", search)}>체육관 파트너</Link></div>
        <div className="vv-sticky"><Link href={all} className="vv-btn" data-testid="link-about-sticky">운동 클래스 둘러보기 <ArrowRight size={18} /></Link></div>
      </div>
    </Shell>
  );
}
