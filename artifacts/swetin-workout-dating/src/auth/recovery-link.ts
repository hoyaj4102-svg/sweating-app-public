export type RecoveryLink =
  | { kind: "ready"; accessToken: string }
  | { kind: "invalid" }
  | { kind: "absent" };

const RECOVERY_ERROR_CODES = new Set(["otp_expired", "otp_disabled", "flow_state_expired"]);
const ACCESS_TOKEN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const HASH_SECRETS = [
  "access_token",
  "refresh_token",
  "expires_in",
  "expires_at",
  "token_type",
  "type",
  "error",
  "error_code",
  "error_description",
  "provider_token",
];
// Extra token fields a Supabase email link can carry. Only removed from links
// that are not recovery links, so recovery handling stays exactly as before.
const SIGNUP_LINK_SECRETS = [
  "access_token",
  "refresh_token",
  "provider_token",
  "provider_refresh_token",
  "token_hash",
  "token",
  "expires_in",
  "expires_at",
  "token_type",
  "type",
];
const SIGNUP_LINK_TYPES = new Set(["signup", "invite", "magiclink", "email", "email_change"]);
const QUERY_SECRETS = [
  "access_token",
  "refresh_token",
  "expires_in",
  "expires_at",
  "token_type",
  "error",
  "error_code",
  "error_description",
];

let remembered: RecoveryLink = { kind: "absent" };

function params(value: string, prefix: "#" | "?"): URLSearchParams {
  const raw = value.startsWith(prefix) ? value.slice(1) : value;
  return new URLSearchParams(raw);
}

export function parseRecoveryLink(hash: string, search: string): RecoveryLink {
  const fragment = params(hash, "#");
  const query = params(search, "?");
  const errorCode = fragment.get("error_code") ?? query.get("error_code");
  if (errorCode && RECOVERY_ERROR_CODES.has(errorCode)) return { kind: "invalid" };

  const type = fragment.get("type") ?? query.get("type");
  if (type !== "recovery") return { kind: "absent" };

  const accessToken = fragment.get("access_token") ?? query.get("access_token") ?? "";
  if (accessToken.length >= 20 && accessToken.length <= 8192 && ACCESS_TOKEN.test(accessToken)) {
    return { kind: "ready", accessToken };
  }
  return { kind: "invalid" };
}

export function rememberRecoveryLink(link: RecoveryLink): void {
  if (link.kind !== "absent") remembered = link;
}

export function currentRecoveryLink(): RecoveryLink {
  return remembered;
}

export function clearRecoveryLink(): void {
  remembered = { kind: "absent" };
}

export function readRecoveryArrival(): RecoveryLink {
  if (typeof window === "undefined") return currentRecoveryLink();
  const parsed = parseRecoveryLink(window.location.hash, window.location.search);
  if (parsed.kind !== "absent") {
    rememberRecoveryLink(parsed);
    return parsed;
  }
  return currentRecoveryLink();
}

function hashWithoutSecrets(hash: string): string {
  if (!hash) return "";
  const parsed = params(hash, "#");
  let changed = false;
  for (const key of HASH_SECRETS) {
    if (!parsed.has(key)) continue;
    parsed.delete(key);
    changed = true;
  }
  if (!changed) return hash.startsWith("#") ? hash : `#${hash}`;
  const serialized = parsed.toString();
  return serialized ? `#${serialized}` : "";
}

/** Drop recovery tokens and error params while leaving the rest of the URL. */
export function recoveryUrlWithoutSecrets(href: string): string {
  const absolute = /^[a-z][a-z0-9+.-]*:/i.test(href);
  const url = new URL(href, "http://localhost");
  if (parseRecoveryLink(url.hash, url.search).kind === "absent") return href;

  for (const key of QUERY_SECRETS) url.searchParams.delete(key);
  if (url.searchParams.get("type") === "recovery") url.searchParams.delete("type");
  url.hash = hashWithoutSecrets(url.hash);
  const relative = `${url.pathname}${url.search}${url.hash}`;
  return absolute ? `${url.origin}${relative}` : relative;
}

function isSignupLinkIn(values: URLSearchParams): boolean {
  const type = values.get("type");
  if (type === "recovery") return false;
  if (type && SIGNUP_LINK_TYPES.has(type)) return true;
  return values.has("access_token") || values.has("refresh_token") || values.has("token_hash");
}

/**
 * True when the URL carries a non-recovery Supabase email link (for example
 * `#access_token=…&type=signup`). The app never signs in with these tokens:
 * email confirmation already finished on Supabase's side, so they are only
 * dropped from the address bar.
 */
export function isSignupLink(hash: string, search: string): boolean {
  if (parseRecoveryLink(hash, search).kind !== "absent") return false;
  return isSignupLinkIn(params(hash, "#")) || isSignupLinkIn(params(search, "?"));
}

function withoutKeys(values: URLSearchParams, keys: readonly string[]): boolean {
  let changed = false;
  for (const key of keys) {
    if (!values.has(key)) continue;
    values.delete(key);
    changed = true;
  }
  return changed;
}

/** Drop signup (non-recovery) email link tokens while leaving the rest of the URL. */
export function signupUrlWithoutSecrets(href: string): string {
  const absolute = /^[a-z][a-z0-9+.-]*:/i.test(href);
  const url = new URL(href, "http://localhost");
  if (!isSignupLink(url.hash, url.search)) return href;

  const fragment = params(url.hash, "#");
  if (isSignupLinkIn(fragment) && withoutKeys(fragment, SIGNUP_LINK_SECRETS)) {
    const serialized = fragment.toString();
    url.hash = serialized ? `#${serialized}` : "";
  }
  if (isSignupLinkIn(url.searchParams)) withoutKeys(url.searchParams, SIGNUP_LINK_SECRETS);
  const relative = `${url.pathname}${url.search}${url.hash}`;
  return absolute ? `${url.origin}${relative}` : relative;
}

type AddressBar = {
  location: { href: string; hash: string; search: string };
  history: { state: unknown; replaceState(data: unknown, unused: string, url?: string | URL | null): void };
};

/**
 * Remove signup link tokens from the address bar without reading them into
 * memory, storage, cookies, or a session request. Returns true when it changed
 * the URL. Recovery links are left for the reset flow.
 */
export function discardSignupLink(target: AddressBar | undefined = typeof window === "undefined" ? undefined : window): boolean {
  if (!target) return false;
  const { location, history } = target;
  if (!isSignupLink(location.hash, location.search)) return false;
  const next = signupUrlWithoutSecrets(location.href);
  if (next === location.href) return false;
  history.replaceState(history.state, "", next);
  return true;
}
