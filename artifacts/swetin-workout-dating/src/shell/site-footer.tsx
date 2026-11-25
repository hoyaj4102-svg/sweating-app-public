import React from "react";
import { Link } from "wouter";
import { Brand } from "./site-header";

export function SiteFooter() {
  return (
    <footer className="site-footer wrap">
      <Brand />
      <span>예시시, 대한민국 · 2026</span>
      <nav aria-label="법적 고지">
        <Link href="/terms">이용약관</Link>
        <Link href="/privacy">개인정보 처리방침</Link>
      </nav>
    </footer>
  );
}
