import React, { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Link, useLocation } from "wouter";
import { useSearch as useRawSearch } from "wouter/use-browser-location";
import { LogOut, Menu, X } from "lucide-react";
import { withCampaign } from "@/visual-v2/campaign";

export type HeaderSession = {
  profile?: {
    display_name?: string | null;
    is_admin?: boolean;
  } | null;
} | null;

type SiteHeaderProps = {
  session: HeaderSession;
  signOut: () => void | Promise<void>;
  showClassDemo?: boolean;
  showUxDemo?: boolean;
};

export function Brand({ dark = false }: { dark?: boolean }) {
  const search = useRawSearch();
  return <Link href={withCampaign("/", search)} className={`brand ${dark ? "brand-dark" : ""}`}>SWEATING</Link>;
}

export function SiteHeader({ session, signOut, showClassDemo = false, showUxDemo = false }: SiteHeaderProps) {
  const [open, setOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [, navigate] = useLocation();
  const search = useRawSearch();
  const accountMenuId = useId();
  const accountRef = useRef<HTMLDivElement>(null);
  const accountButtonRef = useRef<HTMLButtonElement>(null);
  const to = (path: string) => ["/", "/home", "/about", "/start", "/partners"].includes(path) ? withCampaign(path, search) : path;
  const go = (path: string) => {
    setOpen(false);
    setAccountOpen(false);
    navigate(to(path));
  };
  const [ownsGym, setOwnsGym] = useState(false);
  const initial = session?.profile?.display_name?.slice(0, 1) ?? "나";

  useEffect(() => {
    if (!session) {
      setOwnsGym(false);
      return;
    }
    const controller = new AbortController();
    void fetch("/api/owner/gyms", { credentials: "include", signal: controller.signal })
      .then(async (result) => {
        if (!result.ok) return false;
        const rows = await result.json() as unknown;
        return Array.isArray(rows) && rows.length > 0;
      })
      .then((owned) => {
        if (!controller.signal.aborted) setOwnsGym(owned);
      })
      .catch(() => {
        if (!controller.signal.aborted) setOwnsGym(false);
      });
    return () => controller.abort();
  }, [session]);

  useEffect(() => {
    if (!accountOpen) return;
    const menu = accountRef.current;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setAccountOpen(false);
      accountButtonRef.current?.focus();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (menu?.contains(event.target as Node)) return;
      setAccountOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [accountOpen]);

  const onAccountMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End") return;
    const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("[role='menuitem']")];
    if (!items.length) return;
    event.preventDefault();
    const current = items.indexOf(event.target as HTMLButtonElement);
    const last = items.length - 1;
    const nextIndex = event.key === "Home" ? 0
      : event.key === "End" ? last
      : event.key === "ArrowDown" ? (current < 0 ? 0 : (current + 1) % items.length)
      : (current < 0 ? last : (current - 1 + items.length) % items.length);
    items[nextIndex]?.focus();
  };

  return (
    <>
      <header className="site-header">
        <Brand />
        <nav className="m-nav" aria-label="주요 메뉴"><Link href={to("/about")}>소개</Link><Link href={to("/partners")}>파트너</Link></nav>
        <nav className="desktop-nav">
          {session ? <><Link href={to("/home")}>클래스</Link><Link href="/activity">내 활동</Link><Link href="/matches">매치</Link><Link href="/messages" data-testid="link-header-messages">메시지</Link>{ownsGym && <Link href="/owner" data-testid="link-header-owner">내 체육관</Link>}{session.profile?.is_admin && <Link href="/admin">관리</Link>}</> : <><Link href={to("/about")}>소개</Link><Link href={to("/home")}>클래스</Link></>}<Link href={to("/partners")}>체육관 파트너</Link>{showClassDemo && <Link href="/preview/capacity" data-testid="link-header-sample-capacity">정원 샘플</Link>}{showUxDemo && <Link href="/preview/workout" data-testid="link-header-money-demo">SWM 데모</Link>}
        </nav>
        <div className="header-actions">
          {session ? <div className="account-menu" ref={accountRef}>
            <button
              type="button"
              ref={accountButtonRef}
              className="avatar-button header-avatar"
              aria-label="계정 메뉴"
              aria-haspopup="menu"
              aria-expanded={accountOpen}
              aria-controls={accountMenuId}
              data-testid="button-header-account"
              onClick={() => { setOpen(false); setAccountOpen(value => !value); }}
            >{initial}</button>
            {accountOpen && <div id={accountMenuId} className="account-menu-panel" role="menu" aria-label="계정" onKeyDown={onAccountMenuKeyDown}>
              <button type="button" role="menuitem" onClick={() => go("/home")}>클래스 둘러보기</button>
              <button type="button" role="menuitem" onClick={() => go("/activity")}>내 활동</button>
              <button type="button" role="menuitem" onClick={() => go("/matches")}>매치</button>
              <button type="button" role="menuitem" data-testid="button-account-messages" onClick={() => go("/messages")}>메시지</button>
              <button type="button" role="menuitem" onClick={() => go("/profile")}>프로필 설정</button>
              {ownsGym && <button type="button" role="menuitem" onClick={() => go("/owner")}>내 체육관</button>}
              {session.profile?.is_admin && <button type="button" role="menuitem" onClick={() => go("/admin")}>관리자</button>}
              <button type="button" role="menuitem" className="account-signout" data-testid="button-header-logout" onClick={() => void signOut()}>로그아웃 <LogOut size={16} aria-hidden="true" /></button>
            </div>}
          </div> : <Link href={to("/start")} className="header-start" data-testid="link-header-start" onClick={() => { setOpen(false); setAccountOpen(false); }}>시작하기</Link>}
          <button className="menu-trigger" onClick={() => { setAccountOpen(false); setOpen(true); }} aria-label="메뉴 열기"><Menu size={19} /></button>
        </div>
      </header>
      {showUxDemo && <div className="dev-strip"><span>DEV</span><Link href="/preview/classes" className="demo-entry dev-strip-link" data-testid="link-full-demo-entry">전체 데모 체험하기</Link></div>}
      {open && <div className="mobile-drawer">
        <button className="drawer-close" onClick={() => setOpen(false)} aria-label="메뉴 닫기"><X /></button>
        <Brand dark />
         {showClassDemo && <button onClick={() => go("/preview/capacity")}>정원 설정 샘플</button>}{showUxDemo && <button className="demo-entry" onClick={() => go("/preview/classes")} data-testid="button-drawer-full-demo">전체 데모 체험하기</button>}{showUxDemo && <button onClick={() => go("/preview/workout")}>개발자 데모: SWEAT MONEY</button>}
         {session ? <><button onClick={() => go("/home")}>클래스 둘러보기</button><button onClick={() => go("/activity")}>내 활동</button><button onClick={() => go("/matches")}>매치</button><button onClick={() => go("/messages")} data-testid="button-drawer-messages">메시지</button><button onClick={() => go("/profile")}>프로필 설정</button>{ownsGym && <button onClick={() => go("/owner")}>내 체육관</button>}{session.profile?.is_admin && <button onClick={() => go("/admin")}>관리자</button>}<button className="drawer-signout" onClick={() => void signOut()}>로그아웃 <LogOut size={16} /></button></> : <><button onClick={() => go("/about")}>SWEATING 소개</button><button onClick={() => go("/home")}>클래스 둘러보기</button><button onClick={() => go("/partners")}>체육관 파트너</button><button onClick={() => go("/start")} data-testid="button-drawer-start">시작하기</button></>}
      </div>}
    </>
  );
}
