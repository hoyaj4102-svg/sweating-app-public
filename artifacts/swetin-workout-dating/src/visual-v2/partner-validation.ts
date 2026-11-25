export type PartnerInput = {
  gymName: string; contactName: string; phone: string; email: string;
  region: string; address: string; sports: string[]; intro: string; website: string; consent: boolean;
};
export function isSafeWebsite(value: string): boolean {
  if (!value.trim()) return true;
  if (value.length > 300 || /\s/.test(value)) return false;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !!url.hostname && !url.username && !url.password;
  } catch { return false; }
}
export function validatePartnerInput(input: PartnerInput): Partial<Record<keyof PartnerInput, string>> {
  const errors: Partial<Record<keyof PartnerInput, string>> = {};
  for (const key of ["gymName", "contactName", "region", "address", "intro"] as const) {
    if (!input[key].trim()) errors[key] = "필수 항목을 입력해 주세요.";
    else if (input[key].length > (key === "intro" ? 1000 : 150)) errors[key] = "입력 내용이 너무 길어요.";
  }
  const phone = input.phone.trim();
  if (!/^[+0-9()\s-]+$/.test(phone) || phone.replace(/\D/g, "").length < 8 || phone.replace(/\D/g, "").length > 15) errors.phone = "유효한 연락처를 입력해 주세요.";
  if (input.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) errors.email = "유효한 이메일을 입력해 주세요.";
  if (!input.sports.length) errors.sports = "운영 종목을 한 개 이상 선택해 주세요.";
  if (!isSafeWebsite(input.website)) errors.website = "계정 정보가 없는 http 또는 https 주소를 입력해 주세요.";
  if (!input.consent) errors.consent = "데모 제휴 문의 동의를 확인해 주세요.";
  return errors;
}
