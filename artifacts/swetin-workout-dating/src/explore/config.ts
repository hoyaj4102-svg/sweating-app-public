import type { ComponentType, ReactNode } from "react";
import type { AuthSession, ClassDetail } from "@workspace/api-client-react";
import { demoModeEnabled } from "@/visual-v2/demo-enrollment";
import { classHasStarted } from "./detail-state";

/** Explicit, development-only preview flag. Production builds can never enable it. */
export const isClassDemoMode = import.meta.env.DEV && import.meta.env.VITE_CLASS_DEMO_MODE === "true";
/** UI simulations only; does not alter authentication or server permissions. */
export const isUxDemoMode = import.meta.env.DEV && demoModeEnabled(import.meta.env.DEV, import.meta.env.VITE_ENABLE_DEMO_MODE);

export const SPORT_FILTERS = ["전체", "러닝", "복싱", "클라이밍", "테니스", "요가", "서핑", "근력 운동"];

export type ExploreProps = {
  Shell: ComponentType<{ children: ReactNode }>;
  session: AuthSession | null;
};

export function formatDateTime(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "일정 미정";
  return new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", weekday: "short", hour: "numeric", minute: "2-digit" }).format(d);
}

export function formatPrice(price: number) {
  return price > 0 ? `${price.toLocaleString("ko-KR")}원` : "무료";
}

export function slotState(item: ClassDetail): { label: string; tone: "open" | "low" | "closed" } {
  if (item.status === "completed") return { label: "종료", tone: "closed" };
  if (item.status === "cancelled") return { label: "취소됨", tone: "closed" };
  if (item.remaining_slots < 1 || classHasStarted(item.scheduled_at)) return { label: "마감", tone: "closed" };
  if (item.remaining_slots <= 2) return { label: `마감 임박 · ${item.remaining_slots}자리`, tone: "low" };
  return { label: `${item.remaining_slots}자리 남음`, tone: "open" };
}
