import { SaveMyProfileBody } from "@workspace/api-zod";
import {
  AGE_BAND_ERROR,
  BIRTH_YEAR_REQUIRED_ERROR,
  ageBandForBirthYear,
  isAgePreference,
  type AgePreference,
} from "./age-band";

export const PROFILE_INPUT_ERROR = "이름, 사진, 출생 연도, 운동, 관심사를 입력해 주세요.";
export const PROFILE_IS_ADMIN_ERROR = "is_admin은 변경할 수 없습니다.";

export type ProfileWrite = {
  display_name: string;
  birth_year: number;
  gender: string | null;
  profile_photo_url: string;
  sports: string[];
  interests: string[];
  bio: string | null;
  age_preference?: AgePreference;
};

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

const profileBody = SaveMyProfileBody.strict().superRefine((value, context) => {
  if (value.display_name.length > 40) context.addIssue({ code: "custom", message: "display_name" });
  if (value.profile_photo_url.length > 2000) context.addIssue({ code: "custom", message: "profile_photo_url" });
  if ((value.gender?.length ?? 0) > 40) context.addIssue({ code: "custom", message: "gender" });
  if ((value.bio?.length ?? 0) > 4000) context.addIssue({ code: "custom", message: "bio" });
  if (value.birth_year != null && (value.birth_year < 1900 || value.birth_year > 2100)) {
    context.addIssue({ code: "custom", message: "birth_year" });
  }
  if (
    value.birth_year != null &&
    value.birth_year >= 1900 &&
    value.birth_year <= 2100 &&
    ageBandForBirthYear(value.birth_year) == null
  ) {
    context.addIssue({ code: "custom", message: "birth_year_band" });
  }
  if (value.sports.length > 20 || value.sports.some((item) => item.length < 1 || item.length > 40)) {
    context.addIssue({ code: "custom", message: "sports" });
  }
  if (value.interests.length > 20 || value.interests.some((item) => item.length < 1 || item.length > 40)) {
    context.addIssue({ code: "custom", message: "interests" });
  }
});

function record(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  return body as Record<string, unknown>;
}

export function parseProfileWrite(body: unknown): ParseResult<ProfileWrite> {
  const fields = record(body);
  if (fields && Object.hasOwn(fields, "is_admin")) {
    return { ok: false, error: PROFILE_IS_ADMIN_ERROR };
  }
  if (fields && Object.hasOwn(fields, "age_preference") && !isAgePreference(fields.age_preference)) {
    return { ok: false, error: PROFILE_INPUT_ERROR };
  }
  const parsed = profileBody.safeParse(body);
  if (!parsed.success) {
    const band = parsed.error.issues.some((issue) => issue.message === "birth_year_band");
    if (band) return { ok: false, error: AGE_BAND_ERROR };
    const input = record(body);
    if (input && !Object.hasOwn(input, "birth_year")) {
      return { ok: false, error: BIRTH_YEAR_REQUIRED_ERROR };
    }
    return { ok: false, error: PROFILE_INPUT_ERROR };
  }
  if (parsed.data.birth_year == null) return { ok: false, error: BIRTH_YEAR_REQUIRED_ERROR };
  if (ageBandForBirthYear(parsed.data.birth_year) == null) return { ok: false, error: AGE_BAND_ERROR };
  return {
    ok: true,
    value: {
      display_name: parsed.data.display_name,
      birth_year: parsed.data.birth_year,
      gender: parsed.data.gender ?? null,
      profile_photo_url: parsed.data.profile_photo_url,
      sports: parsed.data.sports,
      interests: parsed.data.interests,
      bio: parsed.data.bio ?? null,
      ...(isAgePreference(parsed.data.age_preference) ? { age_preference: parsed.data.age_preference } : {}),
    },
  };
}
