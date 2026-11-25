export const AGE_BANDS = ["20_25", "26_35", "36_45"] as const;

export type AgeBand = (typeof AGE_BANDS)[number];

export const AGE_PREFERENCES = ["same_band", "both"] as const;

export type AgePreference = (typeof AGE_PREFERENCES)[number];

export const MIN_MATCH_AGE = 20;
export const MAX_MATCH_AGE = 45;

export const BIRTH_YEAR_LOCKED_ERROR = "출생 연도는 한 번 저장하면 바꿀 수 없어요.";
export const BIRTH_YEAR_REQUIRED_ERROR = "출생 연도를 입력해 주세요.";
export const AGE_BAND_ERROR = "현재 모집은 출생 연도 기준 20세부터 45세까지예요.";
export const JOIN_BIRTH_YEAR_ERROR = "출생 연도를 저장한 뒤 참가할 수 있어요.";
export const JOIN_CLASS_BAND_ERROR = "연령 구간이 정해진 클래스만 참가할 수 있어요.";
export const JOIN_OWN_BAND_ERROR = "이 연령 구간에는 참가할 수 없어요.";

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
  const year = new Intl.DateTimeFormat("en-US", { timeZone: SEOUL, year: "numeric" }).format(now);
  return Number(year);
}

/** Seoul calendar year minus birth year. This is not verified 만 나이. */
export function ageFromBirthYear(birthYear: number, now: Date = new Date()): number {
  return seoulYear(now) - birthYear;
}

export function isAgeBand(value: unknown): value is AgeBand {
  return value === "20_25" || value === "26_35" || value === "36_45";
}

export function isAgePreference(value: unknown): value is AgePreference {
  return value === "same_band" || value === "both";
}

export function ageBandForBirthYear(
  birthYear: number | null | undefined,
  now: Date = new Date(),
): AgeBand | null {
  if (birthYear == null || !Number.isInteger(birthYear)) return null;
  const age = ageFromBirthYear(birthYear, now);
  if (age >= MIN_MATCH_AGE && age <= 25) return "20_25";
  if (age >= 26 && age <= 35) return "26_35";
  if (age >= 36 && age <= MAX_MATCH_AGE) return "36_45";
  return null;
}

export function birthYearBounds(now: Date = new Date()): { min: number; max: number } {
  const year = seoulYear(now);
  return { min: year - MAX_MATCH_AGE, max: year - MIN_MATCH_AGE };
}

/**
 * same_band is older-preference off. both is on, and only the next band up.
 * A null class band allows everyone. A lower band allows ages through its max + 3.
 */
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

export type ClassViewer = {
  birthYear: number | null;
  agePreference?: unknown;
  isAdmin: boolean;
} | null;

/** Published classes with a known band or no band are listed. Eligibility is separate. */
export function classVisibleToViewer(
  classBand: string | null | undefined,
  viewer: ClassViewer,
): boolean {
  if (viewer?.isAdmin) return true;
  if (classBand == null) return true;
  return isAgeBand(classBand);
}

export function joinBandError(
  classBand: string | null | undefined,
  viewer: { birthYear: number | null; agePreference?: unknown; isAdmin: boolean },
  now: Date = new Date(),
): string | null {
  if (viewer.isAdmin) return null;
  if (classBand == null) return null;
  if (!isAgeBand(classBand)) return JOIN_CLASS_BAND_ERROR;
  const own = ageBandForBirthYear(viewer.birthYear, now);
  if (!own) return JOIN_BIRTH_YEAR_ERROR;
  if (!memberCanJoinAgeBand(viewer.birthYear, viewer.agePreference, classBand, now)) {
    return JOIN_OWN_BAND_ERROR;
  }
  return null;
}

export type ProfileAgeFields = {
  birth_year: number | null;
  age_preference?: unknown;
  age_band?: AgeBand | null;
  birth_year_locked?: boolean;
};

export function withAgeFields<T extends ProfileAgeFields>(row: T, now: Date = new Date()): Omit<T, "age_preference"> & {
  age_preference?: AgePreference;
  age_band: AgeBand | null;
  birth_year_locked: boolean;
} {
  const { age_preference: rawPreference, ...rest } = row;
  return {
    ...rest,
    ...(isAgePreference(rawPreference) ? { age_preference: rawPreference } : {}),
    age_band: ageBandForBirthYear(row.birth_year, now),
    birth_year_locked: row.birth_year != null,
  };
}
