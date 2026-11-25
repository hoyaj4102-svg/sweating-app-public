import React from "react";
import { Link } from "wouter";
import { Home, LayoutGrid, MessageCircle, User } from "lucide-react";

export function HomeNav({ onBrowse }: { onBrowse: () => void }) {
  return (
    <nav className="hv-nav" aria-label="하단 메뉴" data-testid="nav-bottom">
      <Link href="/home" className="on" aria-current="page" data-testid="nav-home"><Home size={20} />홈</Link>
      <button type="button" onClick={onBrowse} data-testid="nav-classes"><LayoutGrid size={20} />클래스</button>
      <Link href="/messages" data-testid="nav-messages"><MessageCircle size={20} />메시지</Link>
      <Link href="/profile" data-testid="nav-mypage"><User size={20} />마이페이지</Link>
    </nav>
  );
}
