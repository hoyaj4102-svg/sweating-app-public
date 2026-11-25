import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { useSearch } from "wouter/use-browser-location";
import { usePageMeta } from "@/visual-v2/meta";
import { MapPin, Search, SlidersHorizontal, Sparkles } from "lucide-react";
import { listClasses } from "@workspace/api-client-react";
import type { ClassDetail } from "@workspace/api-client-react";
import { ClassCard } from "./ClassCard";
import { isClassDemoMode, type ExploreProps } from "./config";
import "./home-brand.css";
import heroImg from "../assets/brand/running-together.jpg";
import { HomeNav } from "./HomeNav";
import { HOME_CATEGORIES, apiSport, buildHomeUrl, filterClasses, parseHome, type HomeState } from "./home-filters";
import { withCampaign } from "../visual-v2/campaign";
import { listDemoClasses, useDemoClasses } from "./demo-data";

type Loaded = { sport: string; items: ClassDetail[] };
const REGION = isClassDemoMode ? "예시시·샘플 지역" : "전체 지역";

export function DemoBanner() {
  return <div className="ex-demo" role="note" data-testid="banner-demo"><strong>샘플 미리보기</strong><span>이 화면의 클래스는 UI 확인용 샘플이에요. 실제 신청·관심·매치는 동작하지 않습니다.</span><Link href="/preview/capacity" className="ex-demo-link" data-testid="link-sample-capacity">성별 정원 설정 샘플 열기</Link></div>;
}

export function ExploreHome({ Shell, session }: ExploreProps) {
  const [path, navigate] = useLocation();
  usePageMeta(path === "/home" ? "오늘, 누구와 함께 운동할까요? | SWEATING" : "움직여야, 좋은 사람을 만난다. | SWEATING", "운동 클래스를 탐색하고 함께 움직이며 새로운 인연을 발견하세요.");
  const search = useSearch();
  const st = useMemo(() => parseHome(search), [search]);
  const wanted = st.sport;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  const [searchOpen, setSearchOpen] = useState(!!st.q);
  const [filterOpen, setFilterOpen] = useState(st.open || st.free);
  const demoSnap = useDemoClasses();
  const listRef = useRef<HTMLElement>(null);

  useEffect(() => {
    let cancelled = false;
    setError("");
    const param = apiSport(wanted);
    if (isClassDemoMode) {
      setLoaded({ sport: wanted, items: listDemoClasses(param).map(c => c.item) });
      return;
    }
    listClasses(param ? { sport: param } : undefined)
      .then(items => { if (!cancelled) setLoaded({ sport: wanted, items }); })
      .catch(() => { if (!cancelled) setError("클래스를 불러오지 못했어요. 잠시 후 다시 시도해 주세요."); });
    return () => { cancelled = true; };
  }, [wanted, tick, demoSnap]);

  const update = (patch: Partial<HomeState>) => navigate(withCampaign(buildHomeUrl({ ...st, ...patch }), search), { replace: true });
  const pending = !!loaded && loaded.sport !== wanted && !error;
  const shown = useMemo(() => (loaded ? filterClasses(loaded.items, st) : []), [loaded, st]);
  const back = withCampaign(buildHomeUrl(st), search);
  const filtered = st.q.trim() || st.open || st.free;
  const emptyText = loaded && !shown.length ? (filtered ? "조건에 맞는 클래스가 없어요. 검색어나 필터를 바꿔 보세요." : wanted === "전체" ? "아직 열린 클래스가 없어요." : `${wanted} 클래스는 아직 준비되지 않았어요. 다른 종목을 먼저 둘러보세요.`) : "";

  return (
    <div className="home-v1" data-testid="page-home">
      <Shell>
        {path !== "/home" && <section className="cm-hero" data-testid="hero-official">
          <img src={heroImg} alt="함께 달리며 웃는 남녀" fetchPriority="high" />
          <div className="cm-hero-copy">
            <h1><span className="l1">움직여야,</span><span className="l2">좋은 사람을 만난다.</span></h1>
            <p className="cm-sub">MOVE TO MEET.</p>
            <Link href={withCampaign("/start", search)} className="cm-cta" data-testid="link-hero-start">지금 시작하기 <span aria-hidden="true">→</span></Link>
          </div>
        </section>}
        <div className="hv-wrap">
          <section className="hv-top">
            <p className="hv-eyebrow">MOVE TO MEET.</p>
            {path === "/home" ? <h1>오늘, 누구와<br />함께 운동할까요?</h1> : <h2 className="cm-h2">오늘, 누구와 함께 운동할까요?</h2>}
            <span className="hv-region" data-testid="text-region"><MapPin size={14} />{REGION}</span>
            <div className="hv-tools">
              <button type="button" className="hv-btn grow" aria-expanded={searchOpen} aria-controls="hv-search" onClick={() => setSearchOpen(o => !o)} data-testid="button-search"><Search size={16} />클래스·장소 검색</button>
              <button type="button" className={`hv-btn ${st.open || st.free ? "on" : ""}`} aria-expanded={filterOpen} aria-controls="hv-filter" onClick={() => setFilterOpen(o => !o)} data-testid="button-filter"><SlidersHorizontal size={16} />필터</button>
            </div>
            {searchOpen && <div className="hv-panel" id="hv-search">
              <label htmlFor="hv-q" className="hv-hint">클래스 이름 또는 장소 이름</label>
              <input id="hv-q" className="hv-input" type="search" autoFocus value={st.q} onChange={e => update({ q: e.target.value })} placeholder="예: 러닝, 요가" data-testid="input-search" />
              <p className="hv-hint">현재 불러온 클래스 안에서만 찾아요.</p>
            </div>}
            {filterOpen && <div className="hv-panel" id="hv-filter">
              <div className="hv-row"><span id="lb-open">모집 중인 클래스만</span><button type="button" role="switch" aria-checked={st.open} aria-labelledby="lb-open" className="hv-switch" onClick={() => update({ open: !st.open })} data-testid="switch-open" /></div>
              <div className="hv-row"><span id="lb-free">무료 클래스만</span><button type="button" role="switch" aria-checked={st.free} aria-labelledby="lb-free" className="hv-switch" onClick={() => update({ free: !st.free })} data-testid="switch-free" /></div>
            </div>}
          </section>
          <div className="hv-cats" role="group" aria-label="운동 종목">
            {HOME_CATEGORIES.map(s => <button key={s} type="button" className="hv-pill" aria-pressed={wanted === s} onClick={() => update({ sport: s })} data-testid={`filter-${s}`}>{s}</button>)}
          </div>
          <section className="ex-list" ref={listRef} id="class-list" style={{ padding: 0 }} tabIndex={-1}>
            {isClassDemoMode && <DemoBanner />}
            <div className="hv-bar">
              <span className="hv-count" role="status" data-testid="text-count">{loaded && !error ? `클래스 ${shown.length}개` : "\u00a0"}</span>
              <div className="hv-seg" role="group" aria-label="보기 방식">
                <button type="button" aria-pressed={st.view === "list"} onClick={() => update({ view: "list" })} data-testid="mode-list">목록</button>
                <button type="button" aria-pressed={st.view === "map"} onClick={() => update({ view: "map" })} data-testid="mode-map">지도</button>
              </div>
            </div>
            {error && <div className="hv-err" role="alert"><p>{error}</p><button className="text-link" onClick={() => setTick(t => t + 1)} data-testid="button-retry">다시 불러오기</button></div>}
            {!loaded && !error && <div className="hv-grid" aria-busy="true">{[0, 1, 2].map(i => <div className="ex-skel" key={i} />)}</div>}
            {loaded && !error && st.view === "map" && <div className="hv-map" data-testid="panel-map">
              <MapPin size={26} />
              <h2>지도 미리보기 준비 중</h2>
              <p>지도는 다음 단계(Phase 2)에서 안내할 예정이에요.<br />지금 조건에 맞는 클래스는 {shown.length}개예요.</p>
              <button type="button" className="hv-btn" onClick={() => update({ view: "list" })} data-testid="button-back-to-list">목록 보기</button>
            </div>}
            {loaded && !error && st.view === "list" && <div className={`hv-grid ${pending ? "is-pending" : ""}`}>
              {shown.map((item, i) => <ClassCard key={item.id} item={item} index={i} demo={isClassDemoMode} from={wanted === "전체" ? undefined : apiSport(wanted)} back={back} viewer={session?.profile ? { birthYear: session.profile.birth_year, agePreference: session.profile.age_preference, isAdmin: session.profile.is_admin } : null} />)}
            </div>}
            {emptyText && !error && st.view === "list" && <div className="hv-empty" data-testid="state-empty"><Sparkles size={20} /><p>{emptyText}</p></div>}
          </section>
        </div>
        <HomeNav onBrowse={() => { update({ view: "list" }); listRef.current?.scrollIntoView({ behavior: "smooth" }); listRef.current?.focus({ preventScroll: true }); }} />
      </Shell>
    </div>
  );
}
