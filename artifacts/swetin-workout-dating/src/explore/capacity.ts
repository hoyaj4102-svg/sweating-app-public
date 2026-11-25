/** Sample-only gender capacity helpers. Pure functions, no I/O. */
export type Gender = "male" | "female";
export const GENDERS: Gender[] = ["male", "female"];
export const GENDER_LABEL: Record<Gender, string> = { male: "남성", female: "여성" };
export type Slot = { capacity: number; joined: number };
export type GenderCapacity = { enabled: true; male: Slot; female: Slot } | { enabled: false };
export type CapacityInput = { total: string; enabled: boolean; male: string; female: string };
export type CapacityErrors = { total?: string; male?: string; female?: string; sum?: string };
export type CapacityResult = {
  ok: boolean;
  errors: CapacityErrors;
  info?: string;
  values?: { total: number; male: number; female: number };
};

/** Strict non-negative integer parse; returns null for blanks, decimals, signs, etc. */
export function parseCount(value: string): number | null {
  const v = value.trim();
  return /^\d{1,4}$/.test(v) ? Number(v) : null;
}

/** Even totals split 50:50. Odd totals return null: no gender is ever privileged silently. */
export function splitEven(total: number): { male: number; female: number } | null {
  return Number.isInteger(total) && total > 0 && total % 2 === 0 ? { male: total / 2, female: total / 2 } : null;
}

export function validateCapacity(input: CapacityInput): CapacityResult {
  const errors: CapacityErrors = {};
  const total = parseCount(input.total);
  if (total === null || total < 1) errors.total = "총정원은 1명 이상의 정수로 입력해 주세요.";
  if (!input.enabled) {
    return total !== null && total >= 1
      ? { ok: true, errors, values: { total, male: 0, female: 0 } }
      : { ok: false, errors };
  }
  const male = parseCount(input.male);
  const female = parseCount(input.female);
  if (male === null) errors.male = "남성 정원은 0 이상의 정수로 입력해 주세요.";
  if (female === null) errors.female = "여성 정원은 0 이상의 정수로 입력해 주세요.";
  let info: string | undefined;
  if (total !== null && total >= 1 && total % 2 === 1) {
    info = "홀수 정원은 자동으로 나누지 않아요. 남성·여성 정원을 직접 정해 합계를 맞춰 주세요.";
  }
  if (total !== null && total >= 1 && male !== null && female !== null && male + female !== total) {
    errors.sum = `남성 ${male} + 여성 ${female} = ${male + female}명이에요. 총정원 ${total}명과 ${Math.abs(total - male - female)}명 차이가 나요.`;
  }
  const ok = !errors.total && !errors.male && !errors.female && !errors.sum;
  return ok && total !== null && male !== null && female !== null ? { ok, errors, info, values: { total, male, female } } : { ok: false, errors, info };
}

export type SlotView = { capacity: number; joined: number; remaining: number; full: boolean; pct: number; label: string };
export function slotView(slot: Slot): SlotView {
  const remaining = Math.max(0, slot.capacity - slot.joined);
  const full = slot.capacity <= 0 || slot.joined >= slot.capacity;
  const pct = slot.capacity > 0 ? Math.min(100, Math.round((slot.joined / slot.capacity) * 100)) : 0;
  return { capacity: slot.capacity, joined: slot.joined, remaining, full, pct, label: slot.capacity <= 0 ? "정원 없음" : full ? "마감" : "모집 중" };
}

export const fullMessage = (g: Gender) => `이번 클래스의 ${GENDER_LABEL[g]} 참가 정원이 마감되었어요.`;

export function aggregate(cap: GenderCapacity, totalCapacity: number, joined: number) {
  if (!cap.enabled) return true;
  return cap.male.capacity + cap.female.capacity === totalCapacity && cap.male.joined + cap.female.joined === joined;
}

const g = (mc: number, mj: number, fc: number, fj: number): GenderCapacity => ({ enabled: true, male: { capacity: mc, joined: mj }, female: { capacity: fc, joined: fj } });
/** Demo-only metadata keyed by sample class id. Real classes never get any of this. */
export const SEED_CAPACITY: Record<string, GenderCapacity> = {
  "demo-sunset-run": g(6, 6, 6, 1),
  "demo-boxing-basic": g(4, 2, 4, 4),
  "demo-boxing-fit": g(5, 5, 5, 5),
  "demo-bouldering": { enabled: false },
  "demo-tennis-rally": g(4, 2, 4, 2),
  "demo-yoga-flow": g(7, 5, 7, 4),
  "demo-yoga-park": g(8, 3, 8, 2),
  "demo-surf-lesson": g(3, 2, 3, 2),
};
