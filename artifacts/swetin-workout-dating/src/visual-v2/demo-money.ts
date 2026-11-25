/** Fictional, in-memory UI model. Never imports authentication, API or storage. */
export const SWM_UNIT_COST = 2000;
export const DEMO_CLASS_ID = "fictional-workout-v2";
export const TOP_UP_AMOUNTS = [3000, 5000, 10000, 20000] as const;
export type DemoPerson = {
  id: string; name: string; initial: string; age: number; sport: string; bio: string;
  classId: string; incoming: boolean; blocked: boolean; deleted: boolean; withdrawn: boolean;
};
const person = (id: string, name: string, age: number, sport: string, bio: string, patch: Partial<DemoPerson> = {}): DemoPerson => ({
  id, name, initial: name.slice(0, 1), age, sport, bio, classId: DEMO_CLASS_ID,
  incoming: true, blocked: false, deleted: false, withdrawn: false, ...patch,
});
export const DEMO_PEOPLE: readonly DemoPerson[] = [
  person("p1", "가상 민서", 28, "러닝", "천천히 달리고, 오래 이야기하는 걸 좋아해요."),
  person("p2", "가상 지우", 30, "요가", "움직이는 시간과 조용한 커피 한 잔을 좋아해요."),
  person("p3", "가상 도윤", 29, "클라이밍", "새로운 코스를 함께 도전하고 싶어요."),
  person("p4", "가상 수현", 31, "테니스", "서로 응원하며 운동하는 시간이 좋아요."),
  person("other-class", "다른 클래스 가상 인물", 28, "복싱", "공개 제외", { classId: "other-fictional-class" }),
  person("blocked", "차단된 가상 인물", 29, "러닝", "공개 제외", { blocked: true }),
  person("deleted", "삭제된 가상 인물", 30, "요가", "공개 제외", { deleted: true }),
  person("withdrawn", "관심 취소 가상 인물", 31, "러닝", "공개 제외", { withdrawn: true }),
];
export type DemoEntry = { id: number; kind: "charge" | "reveal" | "super" | "like"; amount: number; count: number };
export type DemoMoneyState = {
  classId: string;
  balance: number; completed: boolean; liked: string[]; revealed: string[]; superLiked: string[]; history: DemoEntry[];
};
export type DemoResult = {
  ok: boolean; state: DemoMoneyState; error?: "not-completed" | "not-eligible" | "insufficient" | "already-super" | "invalid";
};
export function createDemoMoneyState(classId = DEMO_CLASS_ID): DemoMoneyState {
  return { classId, balance: 0, completed: false, liked: ["p4"], revealed: [], superLiked: [], history: [] };
}
export function setWorkoutComplete(state: DemoMoneyState, completed: boolean): DemoMoneyState {
  return { ...state, completed };
}
export function getEligiblePeople(state: DemoMoneyState): DemoPerson[] {
  // The trusted fictional roster is instantiated for the selected demo class only.
  return state.completed ? DEMO_PEOPLE.filter(p => p.classId === DEMO_CLASS_ID && !p.blocked && !p.deleted && !p.withdrawn).map(p => ({ ...p, classId: state.classId })) : [];
}
export function getMatches(state: DemoMoneyState): DemoPerson[] {
  return getEligiblePeople(state).filter(p => p.incoming && state.liked.includes(p.id));
}
export function getUnreadInterest(state: DemoMoneyState): DemoPerson[] {
  return getEligiblePeople(state).filter(p => p.incoming && !state.liked.includes(p.id) && !state.revealed.includes(p.id));
}
export function getRevealQuote(state: DemoMoneyState, ids?: string[]) {
  const unread = getUnreadInterest(state);
  const selected = ids ? [...new Set(ids)].filter(id => unread.some(p => p.id === id)) : unread.map(p => p.id);
  return { ids: selected, cost: selected.length * SWM_UNIT_COST };
}
function ledger(state: DemoMoneyState, kind: DemoEntry["kind"], amount: number, count: number): DemoMoneyState {
  return { ...state, balance: state.balance + amount, history: [{ id: state.history.length + 1, kind, amount, count }, ...state.history] };
}
const fail = (state: DemoMoneyState, error: DemoResult["error"]): DemoResult => ({ ok: false, state, error });
export function topUpDemo(state: DemoMoneyState, amount: number): DemoResult {
  if (!(TOP_UP_AMOUNTS as readonly number[]).includes(amount)) return fail(state, "invalid");
  return { ok: true, state: ledger(state, "charge", amount, 0) };
}
export function spendDemo(state: DemoMoneyState, kind: "reveal" | "super", ids: string[]): DemoResult {
  if (!state.completed) return fail(state, "not-completed");
  const eligible = getEligiblePeople(state);
  const selected = [...new Set(ids)];
  if (!selected.length || selected.some(id => !eligible.some(p => p.id === id))) return fail(state, "not-eligible");
  if (kind === "super") {
    if (selected.length !== 1) return fail(state, "invalid");
    if (state.superLiked.includes(selected[0])) return fail(state, "already-super");
    if (state.balance < SWM_UNIT_COST) return fail(state, "insufficient");
    return { ok: true, state: { ...ledger(state, "super", -SWM_UNIT_COST, 1), superLiked: [...state.superLiked, selected[0]] } };
  }
  const quote = getRevealQuote(state, selected);
  if (!quote.cost) return { ok: true, state }; // Previously revealed/mutual: no second charge.
  if (state.balance < quote.cost) return fail(state, "insufficient");
  return { ok: true, state: { ...ledger(state, "reveal", -quote.cost, quote.ids.length), revealed: [...state.revealed, ...quote.ids] } };
}
export function likeDemo(state: DemoMoneyState, id: string): DemoResult {
  if (!state.completed) return fail(state, "not-completed");
  if (!getEligiblePeople(state).some(p => p.id === id)) return fail(state, "not-eligible");
  if (state.liked.includes(id)) return { ok: true, state };
  return { ok: true, state: { ...ledger(state, "like", 0, 1), liked: [...state.liked, id] } };
}
