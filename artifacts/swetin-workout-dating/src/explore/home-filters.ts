import type { ClassDetail } from "@workspace/api-client-react";

export const HOME_CATEGORIES = ["전체", "러닝", "복싱", "헬스", "요가", "클라이밍", "테니스", "자전거", "수영", "서핑"];
const UI_TO_API: Record<string, string> = { 헬스: "근력 운동" };
export const apiSport = (ui: string) => (ui === "전체" ? undefined : UI_TO_API[ui] ?? ui);
export const uiSport = (v: string | null) => {
  if (!v) return "전체";
  const ui = v === "근력 운동" ? "헬스" : v;
  return HOME_CATEGORIES.includes(ui) ? ui : "전체";
};

export type HomeState = { sport: string; q: string; view: "list" | "map"; open: boolean; free: boolean };

export function parseHome(search: string): HomeState {
  const p = new URLSearchParams(search);
  return { sport: uiSport(p.get("sport")), q: (p.get("q") ?? "").slice(0, 60), view: p.get("view") === "map" ? "map" : "list", open: p.get("open") === "1", free: p.get("free") === "1" };
}

export function buildHomeUrl(s: HomeState) {
  const p = new URLSearchParams();
  const api = apiSport(s.sport);
  if (api) p.set("sport", api);
  if (s.q.trim()) p.set("q", s.q.slice(0, 60));
  if (s.view === "map") p.set("view", "map");
  if (s.open) p.set("open", "1");
  if (s.free) p.set("free", "1");
  const qs = p.toString();
  return qs ? `/home?${qs}` : "/home";
}

/** Only same-app /home URLs with a plain query string are accepted as a return target. */
export function safeHomeReturn(v: string | null | undefined): string | null {
  if (!v || v.length > 1024) return null;
  return !/\s/.test(v) && /^\/home(\?[A-Za-z0-9%=&_.~+*-]*)?$/.test(v) ? v : null;
}

export function filterClasses(items: ClassDetail[], f: Pick<HomeState, "q" | "open" | "free">) {
  const q = f.q.trim().toLowerCase();
  return items.filter(c => {
    if (q && !c.title.toLowerCase().includes(q) && !c.gym.name.toLowerCase().includes(q)) return false;
    if (f.open && (c.status !== "published" || c.remaining_slots < 1)) return false;
    if (f.free && c.price > 0) return false;
    return true;
  });
}
