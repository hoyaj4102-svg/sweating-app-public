import React, { type ReactNode } from "react";
import { Link } from "wouter";
import { SiteFooter } from "@/shell/site-footer";
import { DRAFT_BANNER, privacySections, termsSections } from "./documents";

function LegalLayout({ header, title, children }: { header: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="app-page">
      {header}
      <main className="legal-page wrap">
        <p className="legal-draft" role="note" data-testid="legal-draft">{DRAFT_BANNER}</p>
        <h1>{title}</h1>
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}

export function TermsPage({ header }: { header: ReactNode }) {
  return (
    <LegalLayout header={header} title="이용약관">
      {termsSections.map((section) => (
        <section key={section.heading}>
          <h2>{section.heading}</h2>
          <p>{section.body}</p>
        </section>
      ))}
      <p><Link href="/privacy">개인정보 처리방침</Link></p>
    </LegalLayout>
  );
}

export function PrivacyPage({ header }: { header: ReactNode }) {
  return (
    <LegalLayout header={header} title="개인정보 처리방침">
      {privacySections.map((section) => (
        <section key={section.id} id={section.id}>
          <h2>{section.heading}</h2>
          <p>{section.body}</p>
        </section>
      ))}
      <p><Link href="/terms">이용약관</Link></p>
    </LegalLayout>
  );
}
