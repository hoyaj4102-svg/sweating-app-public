/**
 * Consent items hosted Supabase Auth always sends to Kakao.
 *
 * `NewKakaoProvider` hardcodes `account_email`, `profile_image`, and
 * `profile_nickname`, then appends any `scopes` query value. It does not
 * let this app replace that list. Omitting `scopes` here avoids adding
 * another scope string; it does not remove `account_email`.
 *
 * Kakao rejects the authorize request with KOE205 until each item is
 * enabled under Product Settings → Kakao Login → Consent Items.
 * `account_email` stays unavailable until the Kakao app is a Biz app
 * (App Settings → Business, including the individual registration path).
 */
export const KAKAO_CONSENT_ITEMS = [
  "account_email",
  "profile_nickname",
  "profile_image",
] as const;
