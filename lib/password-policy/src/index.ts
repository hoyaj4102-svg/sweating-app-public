import { COMMON_PASSWORDS } from "./common-passwords.ts";

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 200;
export const EMAIL_LOCAL_PART_MIN = 3;

export type PasswordPolicyReason =
  | "too_short"
  | "too_long"
  | "need_letter_and_number"
  | "too_common"
  | "contains_email";

export const PASSWORD_POLICY_MESSAGES: Record<PasswordPolicyReason, string> = {
  too_short: "비밀번호는 10자 이상이어야 합니다.",
  too_long: "비밀번호는 200자를 넘을 수 없습니다.",
  need_letter_and_number: "비밀번호에 글자와 숫자를 모두 넣어 주세요.",
  too_common: "너무 흔한 비밀번호입니다. 다른 비밀번호를 사용해 주세요.",
  contains_email: "비밀번호에 이메일 주소를 넣지 마세요.",
};

export type PasswordPolicyResult =
  | { ok: true }
  | { ok: false; reason: PasswordPolicyReason };

export function emailLocalPart(email: string | undefined): string {
  if (typeof email !== "string") return "";
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.indexOf("@");
  if (at < EMAIL_LOCAL_PART_MIN) return "";
  const local = trimmed.slice(0, at);
  return local.length >= EMAIL_LOCAL_PART_MIN ? local : "";
}

export function validateNewPassword(
  password: string,
  options?: { email?: string },
): PasswordPolicyResult {
  if (typeof password !== "string" || password.length < PASSWORD_MIN_LENGTH) {
    return { ok: false, reason: "too_short" };
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return { ok: false, reason: "too_long" };
  }
  if (!/\p{L}/u.test(password) || !/\p{N}/u.test(password)) {
    return { ok: false, reason: "need_letter_and_number" };
  }
  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    return { ok: false, reason: "too_common" };
  }
  const local = emailLocalPart(options?.email);
  if (local && password.toLowerCase().includes(local)) {
    return { ok: false, reason: "contains_email" };
  }
  return { ok: true };
}

export function passwordPolicyMessage(reason: PasswordPolicyReason): string {
  return PASSWORD_POLICY_MESSAGES[reason];
}

export const COMMON_PASSWORD_COUNT = COMMON_PASSWORDS.size;
