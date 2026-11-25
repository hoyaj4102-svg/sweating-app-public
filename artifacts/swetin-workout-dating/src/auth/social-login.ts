/** Existing API OAuth start routes. The server owns PKCE state and the session cookie. */
export const socialLoginButtons = [
  {
    id: "kakao",
    label: "카카오로 시작하기",
    startPath: "/api/auth/kakao/start",
    testId: "button-kakao-login",
  },
  {
    id: "google",
    label: "Google 계정으로 시작하기",
    startPath: "/api/auth/google/start",
    testId: "button-google-login",
  },
] as const;

export type SocialLoginProvider = (typeof socialLoginButtons)[number]["id"];

const SAFE_OAUTH_ERROR = /^[가-힣A-Za-z0-9 .,]+$/;

/** Show the server's Korean OAuth error, or a fixed fallback when the query value is not display-safe. */
export function oauthErrorFromSearch(search: string): string {
  const value = new URLSearchParams(search).get("oauth_error")?.trim() ?? "";
  if (!value) return "";
  if (value.length <= 160 && SAFE_OAUTH_ERROR.test(value)) return value;
  return "소셜 로그인에 실패했어요. 잠시 후 다시 시도해 주세요.";
}
