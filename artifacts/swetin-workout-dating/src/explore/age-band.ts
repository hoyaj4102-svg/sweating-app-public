export const AGE_BANDS = ["20_25", "26_35", "36_45"] as const;
export type AgeBand = (typeof AGE_BANDS)[number];

const SEOUL = "Asia/Seoul";

const BAND_MAX: Record<AgeBand, number> = {
  "20_25": 25,
  "26_35": 35,
  "36_45": 45,
};

const NEXT_BAND: Record<AgeBand, AgeBand | null> = {
  "20_25": "26_35",
  "26_35": "36_45",
  "36_45": null,
};

export function seoulYear(now: Date = new Date()): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: SEOUL, year: "numeric" }).format(now));
}

export function ageFromBirthYear(birthYear: number, now: Date = new Date()): number {
  return seoulYear(now) - birthYear;
}

export function isAgeBand(value: unknown): value is AgeBand {
  return value === "20_25" || value === "26_35" || value === "36_45";
}

export function ageBandForBirthYear(birthYear: number | null | undefined, now: Date = new Date()): AgeBand | null {
  if (birthYear == null || !Number.isInteger(birthYear)) return null;
  const age = ageFromBirthYear(birthYear, now);
  if (age >= 20 && age <= 25) return "20_25";
  if (age >= 26 && age <= 35) return "26_35";
  if (age >= 36 && age <= 45) return "36_45";
  return null;
}

export function birthYearBounds(now: Date = new Date()): { min: number; max: number } {
  const year = seoulYear(now);
  return { min: year - 45, max: year - 20 };
}

export function ageBandLabel(band: string | null | undefined): string {
  if (band === "20_25") return "20-25세";
  if (band === "26_35") return "26-35세";
  if (band === "36_45") return "36-45세";
  if (band == null) return "연령 제한 없음";
  return "구간 미정";
}

export type EligibilityViewer = {
  birthYear?: number | null;
  agePreference?: string | null;
  isAdmin?: boolean;
} | null;

export function memberCanJoinAgeBand(
  birthYear: number | null | undefined,
  agePreference: unknown,
  classBand: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (classBand == null) return true;
  if (!isAgeBand(classBand)) return false;
  if (birthYear == null || !Number.isInteger(birthYear)) return false;
  const own = ageBandForBirthYear(birthYear, now);
  if (!own) return false;
  if (own === classBand) return true;
  if (agePreference === "both" && NEXT_BAND[own] === classBand) return true;
  if (BAND_MAX[own] > BAND_MAX[classBand] && ageFromBirthYear(birthYear, now) <= BAND_MAX[classBand] + 3) {
    return true;
  }
  return false;
}

/** Korean copy lives next to the band helper, the same place as the other age labels. */
export function joinEligibilityLabel(
  classBand: string | null | undefined,
  viewer: EligibilityViewer,
  now: Date = new Date(),
): string {
  if (!viewer) return "로그인하면 참가 가능 여부를 확인할 수 있어요.";
  if (viewer.isAdmin) return "관리자는 연령과 관계없이 참가할 수 있어요.";
  if (classBand == null) return "연령 제한이 없어 참가할 수 있어요.";
  if (!isAgeBand(classBand)) return "이 연령 구간에는 참가할 수 없어요.";
  const own = ageBandForBirthYear(viewer.birthYear, now);
  if (!own) return "출생 연도를 저장한 뒤 참가할 수 있어요.";
  if (!memberCanJoinAgeBand(viewer.birthYear, viewer.agePreference, classBand, now)) {
    return "이 연령 구간에는 참가할 수 없어요.";
  }
  if (own === classBand) return "내 구간이라 참가할 수 있어요.";
  if (NEXT_BAND[own] === classBand) return "연상 선호로 참가할 수 있어요.";
  return "아래 구간이라 참가할 수 있어요.";
}
