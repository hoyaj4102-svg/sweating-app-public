import { safeClassReturn } from "../explore/auth-return.ts";

export const DEMO_NOTICE = "개발용 미리보기 — 실제 참가, 매칭 및 결제가 진행되지 않습니다.";
export const DEFAULT_DEMO_CLASS_ID = "demo-sunset-run";
export type DemoEnrollment = { classId: string; returnTo: string | null; joined: boolean };

export const demoModeEnabled = (development: boolean, flag: string | undefined) =>
  development && flag === "true";

const fictionalId = (id: string) => /^demo-[A-Za-z0-9_-]{1,90}$/.test(id);

/** Demo-only return paths; never broadens the real login return allowlist. */
export function safeDemoReturn(value: string | null): string | null {
  return safeClassReturn(value) ?? (value && /^\/preview\/detail\?class=demo-[A-Za-z0-9_-]{1,90}$/.test(value) ? value : null);
}

/** Contains no account identity, booking identifier, API call or persistence. */
export function createDemoEnrollment(classId: string, returnTo: string | null): DemoEnrollment {
  return { classId: fictionalId(classId) ? classId : DEFAULT_DEMO_CLASS_ID, returnTo: safeDemoReturn(returnTo), joined: false };
}

/** Explicit confirmation only. Navigating, selecting or logging in never confirms. */
export function confirmDemoEnrollment(entry: DemoEnrollment | null): DemoEnrollment | null {
  if (!entry || !fictionalId(entry.classId)) return null;
  return entry.joined ? entry : { ...entry, joined: true };
}
