const REDACTED = "[redacted]";

const REDACTED_KEYS = new Set([
  "password",
  "passwd",
  "pwd",
  "secret",
  "token",
  "access_token",
  "refresh_token",
  "id_token",
  "provider_token",
  "provider_refresh_token",
  "authorization",
  "apikey",
  "api_key",
  "cookie",
  "cookies",
  "set_cookie",
  "email",
  "e_mail",
  "phone",
  "tel",
  "mobile",
  "credit_card",
  "creditcard",
  "cardnumber",
  "card_number",
  "card",
  "cvv",
  "cvc",
  "pan",
  "text",
  "message",
  "messages",
  "chat",
  "chatmessage",
  "chat_message",
  "body",
  "content",
  "request_body",
  "response_body",
  "ip",
  "ip_address",
  "forwarded",
  "x_forwarded_for",
  "x_real_ip",
  "x_client_ip",
  "cf_connecting_ip",
  "true_client_ip",
  "fastly_client_ip",
  "fly_client_ip",
]);

const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const PHONE = /\b01[016789][-\s]?\d{3,4}[-\s]?\d{4}\b/g;
const LABELED_VALUE =
  /(?<![A-Za-z0-9_])(password|passwd|pwd|text|message|chat|body)(?![A-Za-z0-9_])\s*[:=]\s*(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\S+)/gi;

export type ScrubOptions = {
  internalUserId: string;
};

function normalizedKey(key: string): string {
  return key.toLowerCase().replace(/-/g, "_");
}

function isRedactedKey(key: string): boolean {
  return REDACTED_KEYS.has(normalizedKey(key));
}

export function isSensitiveHeader(name: string): boolean {
  const key = name.toLowerCase();
  if (
    key === "authorization" ||
    key === "cookie" ||
    key === "set-cookie" ||
    key === "apikey" ||
    key === "api-key" ||
    key === "proxy-authorization"
  ) {
    return true;
  }
  if (
    key === "forwarded" ||
    key === "via" ||
    key === "x-forwarded-for" ||
    key === "x-real-ip" ||
    key === "x-client-ip" ||
    key === "x-cluster-client-ip" ||
    key === "x-original-forwarded-for" ||
    key === "forwarded-for" ||
    key === "cf-connecting-ip" ||
    key === "true-client-ip" ||
    key === "fastly-client-ip" ||
    key === "fly-client-ip" ||
    key === "x-vercel-forwarded-for"
  ) {
    return true;
  }
  if (key.endsWith("-ip") || key.endsWith("_ip") || key.includes("forwarded-for")) return true;
  if (key.startsWith("x-") && /token|key|secret|auth|jwt|session|cookie|password|credential/.test(key)) {
    return true;
  }
  return false;
}

export function isSensitiveQueryName(name: string): boolean {
  const key = normalizedKey(name);
  if (
    key === "token" ||
    key === "code" ||
    key === "key" ||
    key === "password" ||
    key === "passwd" ||
    key === "pwd" ||
    key === "secret" ||
    key === "auth" ||
    key === "session" ||
    key === "apikey" ||
    key === "api_key"
  ) {
    return true;
  }
  return (
    key.endsWith("_token") ||
    key.endsWith("_code") ||
    key.endsWith("_key") ||
    key.startsWith("token_") ||
    key.includes("password") ||
    key.includes("secret") ||
    key.includes("apikey")
  );
}

function luhn(digits: string): boolean {
  let sum = 0;
  let alternate = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = digits.charCodeAt(index) - 48;
    if (digit < 0 || digit > 9) return false;
    if (alternate) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    alternate = !alternate;
  }
  return sum % 10 === 0;
}

function replaceCards(input: string): string {
  return input.replace(/\d(?:[ -]?\d){12,18}/g, (match) => {
    const digits = match.replace(/[ -]/g, "");
    if (digits.length < 13 || digits.length > 19 || !luhn(digits)) return match;
    return REDACTED;
  });
}

function applyPatterns(input: string): string {
  return replaceCards(
    input
      .replace(JWT, REDACTED)
      .replace(EMAIL, REDACTED)
      .replace(PHONE, REDACTED)
      .replace(LABELED_VALUE, (_match, label: string) => `${label}=${REDACTED}`),
  );
}

function scrubQueryString(input: string, leadingQuestion: boolean): string {
  const params = new URLSearchParams(leadingQuestion ? input.slice(1) : input);
  const kept = new URLSearchParams();
  for (const [key, value] of params) {
    if (isSensitiveQueryName(key)) continue;
    kept.append(key, applyPatterns(value));
  }
  const next = kept.toString();
  if (!leadingQuestion) return next;
  return next ? `?${next}` : "";
}

function scrubOneUrl(url: string): string {
  const base = "https://sentry-scrub.invalid";
  try {
    const parsed = new URL(url, base);
    const kept = new URLSearchParams();
    for (const [key, value] of parsed.searchParams) {
      if (isSensitiveQueryName(key)) continue;
      kept.append(key, applyPatterns(value));
    }
    parsed.search = kept.toString();
    if (parsed.hash.includes("=")) {
      const hashParams = new URLSearchParams(parsed.hash.slice(1));
      const keptHash = new URLSearchParams();
      for (const [key, value] of hashParams) {
        if (isSensitiveQueryName(key)) continue;
        keptHash.append(key, applyPatterns(value));
      }
      const nextHash = keptHash.toString();
      parsed.hash = nextHash ? `#${nextHash}` : "";
    } else if (parsed.hash) {
      parsed.hash = `#${applyPatterns(parsed.hash.slice(1))}`;
    }
    if (url.startsWith("http://") || url.startsWith("https://")) return parsed.toString();
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return applyPatterns(url);
  }
}

function scrubString(input: string): string {
  const withUrls = input.replace(/https?:\/\/[^\s"'<>]+|\/[^\s"'<>]*\?[^\s"'<>]+/g, (url) => scrubOneUrl(url));
  const rawQuery = !/\s/.test(withUrls) && withUrls.includes("=") && !withUrls.includes("://") && !withUrls.startsWith("/");
  if (rawQuery) return scrubQueryString(withUrls, withUrls.startsWith("?"));
  return applyPatterns(withUrls);
}

function scrubUnknown(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === "string") return scrubString(value);
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return REDACTED;
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => scrubUnknown(item, seen));
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    output[key] = isRedactedKey(key) ? REDACTED : scrubUnknown(child, seen);
  }
  return output;
}

function scrubHeaders(headers: unknown): Record<string, string> | undefined {
  if (!headers || typeof headers !== "object") return undefined;
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
    if (isSensitiveHeader(key)) continue;
    const text = Array.isArray(value) ? value.map((item) => String(item)).join(", ") : String(value ?? "");
    output[key] = scrubString(text);
  }
  return output;
}

function scrubRequest(request: unknown): unknown {
  if (!request || typeof request !== "object") return request;
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(request as Record<string, unknown>)) {
    if (key === "data" || key === "body" || key === "cookies" || key === "env") continue;
    if (key === "headers") {
      output.headers = scrubHeaders(value);
      continue;
    }
    if ((key === "url" || key === "query_string") && typeof value === "string") {
      output[key] = scrubString(value);
      continue;
    }
    if (key === "query_string") {
      output[key] = scrubUnknown(value, new WeakSet());
      if (output[key] && typeof output[key] === "object" && !Array.isArray(output[key])) {
        const filtered: Record<string, unknown> = {};
        for (const [queryKey, queryValue] of Object.entries(output[key] as Record<string, unknown>)) {
          if (isSensitiveQueryName(queryKey)) continue;
          filtered[queryKey] = queryValue;
        }
        output[key] = filtered;
      }
      continue;
    }
    output[key] = scrubUnknown(value, new WeakSet());
  }
  return output;
}

function scrubFrame(frame: unknown): unknown {
  if (!frame || typeof frame !== "object") return frame;
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(frame as Record<string, unknown>)) {
    if (key === "vars") continue;
    output[key] = scrubUnknown(value, new WeakSet());
  }
  return output;
}

function scrubExceptionValue(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key === "stacktrace" && child && typeof child === "object") {
      const frames = (child as { frames?: unknown }).frames;
      output.stacktrace = {
        frames: Array.isArray(frames) ? frames.map((frame) => scrubFrame(frame)) : [],
      };
      continue;
    }
    output[key] = scrubUnknown(child, new WeakSet());
  }
  return output;
}

function scrubException(exception: unknown): unknown {
  if (!exception || typeof exception !== "object") return exception;
  const source = exception as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (key === "values" && Array.isArray(value)) {
      output.values = value.map((item) => scrubExceptionValue(item));
      continue;
    }
    output[key] = scrubUnknown(value, new WeakSet());
  }
  return output;
}

function scrubBreadcrumb(breadcrumb: unknown): Record<string, unknown> | null {
  if (!breadcrumb || typeof breadcrumb !== "object") return null;
  const source = breadcrumb as Record<string, unknown>;
  if (source.category === "console") {
    const level = typeof source.level === "string" ? source.level : "info";
    if (level !== "error" && level !== "fatal") return null;
  }
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (key === "message") {
      output.message = typeof value === "string" ? scrubString(value) : REDACTED;
      continue;
    }
    if (key === "data") {
      output.data = scrubUnknown(value, new WeakSet());
      continue;
    }
    output[key] = typeof value === "string" ? scrubString(value) : value;
  }
  return output;
}

function scrubBreadcrumbs(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => scrubBreadcrumb(item)).filter((item) => item !== null);
  }
  if (value && typeof value === "object" && Array.isArray((value as { values?: unknown }).values)) {
    const source = value as { values: unknown[] };
    return {
      ...source,
      values: source.values.map((item) => scrubBreadcrumb(item)).filter((item) => item !== null),
    };
  }
  return scrubUnknown(value, new WeakSet());
}

function safeInternalId(id: string): string {
  if (!id || id.length > 80 || scrubString(id) !== id) return "anon-fallback";
  return id;
}

function scrubUser(internalUserId: string): { id: string } {
  return { id: safeInternalId(internalUserId) };
}

function scrubEvent(event: unknown, options: ScrubOptions): Record<string, unknown> {
  if (!event || typeof event !== "object") {
    throw new Error("Sentry event is not an object.");
  }
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(event as Record<string, unknown>)) {
    if (key === "user") continue;
    if (key === "message" || key === "transaction" || key === "logentry") {
      output[key] = scrubUnknown(value, new WeakSet());
      continue;
    }
    if (key === "request") {
      output.request = scrubRequest(value);
      continue;
    }
    if (key === "breadcrumbs") {
      output.breadcrumbs = scrubBreadcrumbs(value);
      continue;
    }
    if (key === "exception") {
      output.exception = scrubException(value);
      continue;
    }
    output[key] = scrubUnknown(value, new WeakSet());
  }
  output.user = scrubUser(options.internalUserId);
  return output;
}

function residueText(value: unknown): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(value, (_key, child: unknown) => {
    if (child && typeof child === "object") {
      if (seen.has(child)) return REDACTED;
      seen.add(child);
    }
    return child;
  }) ?? "";
}

function assertNoSensitiveResidue(value: unknown): void {
  const text = residueText(value);
  if (EMAIL.test(text) || JWT.test(text) || PHONE.test(text)) {
    throw new Error("Sensitive residue remained after scrubbing.");
  }
  EMAIL.lastIndex = 0;
  JWT.lastIndex = 0;
  PHONE.lastIndex = 0;
  const cards = text.match(/\d(?:[ -]?\d){12,18}/g) as string[] | null;
  if ((cards ?? []).some((match) => luhn(match.replace(/[ -]/g, "")))) {
    throw new Error("Card residue remained after scrubbing.");
  }
}

export function scrubBeforeSend<T>(event: T, options: ScrubOptions): T | null {
  try {
    const scrubbed = scrubEvent(event, options);
    assertNoSensitiveResidue(scrubbed);
    return scrubbed as T;
  } catch {
    return null;
  }
}

export function scrubBeforeSendTransaction<T>(event: T, options: ScrubOptions): T | null {
  return scrubBeforeSend(event, options);
}

export function scrubBeforeBreadcrumb<T>(breadcrumb: T): T | null {
  try {
    const scrubbed = scrubBreadcrumb(breadcrumb);
    if (!scrubbed) return null;
    assertNoSensitiveResidue(scrubbed);
    return scrubbed as T;
  } catch {
    return null;
  }
}
