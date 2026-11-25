import cors from "cors";

/**
 * Credentialed CORS allowlist.
 *
 * `CORS_ALLOWED_ORIGINS` — comma-separated exact browser origins.
 *   Production must set this before deploy:
 *     CORS_ALLOWED_ORIGINS=https://app.example.com
 *   That value is the public site origin, not a secret.
 *   When the variable is unset or blank and `NODE_ENV=development`, the
 *   local web (port 5173) and mockup (port 5174) origins are allowed.
 *   Every other environment allows no extra origins until the list is set.
 *
 * `CORS_ALLOW_VERCEL_PREVIEWS` — `true` or `false`.
 *   `true` also allows `https://*.vercel.app`.
 *   Unset: `true` only when `VERCEL_ENV=preview`, otherwise `false`.
 *   Production must leave this unset or `false`.
 *
 * Requests with no Origin header, and same-origin calls on the Vercel
 * host, still receive the normal API response. Credential headers are
 * added only when the Origin is allowlisted.
 *
 * These Vercel system hostnames, when set, are added as exact `https`
 * origins. They are deployment hosts, not secrets:
 *   `VERCEL_URL`, `VERCEL_BRANCH_URL`, `VERCEL_PROJECT_PRODUCTION_URL`.
 *
 * Origins that are not allowed do not get `Access-Control-Allow-Origin`
 * or `Access-Control-Allow-Credentials`. The `cors` package skips every
 * CORS header when the origin callback returns a falsy value.
 */

export type CorsEnvironment = {
  [key: string]: string | undefined;
  NODE_ENV?: string;
  CORS_ALLOWED_ORIGINS?: string;
  CORS_ALLOW_VERCEL_PREVIEWS?: string;
  VERCEL_ENV?: string;
  VERCEL_URL?: string;
  VERCEL_BRANCH_URL?: string;
  VERCEL_PROJECT_PRODUCTION_URL?: string;
};

export type CorsPolicy = {
  exactOrigins: ReadonlySet<string>;
  allowVercelPreviews: boolean;
};

/** Local origins used only when `NODE_ENV=development` and no list is set. */
export const LOCAL_DEV_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:5174",
  "http://127.0.0.1:5174",
] as const;

const VERCEL_HOST_KEYS = [
  "VERCEL_URL",
  "VERCEL_BRANCH_URL",
  "VERCEL_PROJECT_PRODUCTION_URL",
] as const;

const VERCEL_PREVIEW_HOSTNAME =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+vercel\.app$/;

const INVALID_ORIGIN =
  "CORS_ALLOWED_ORIGINS entries must be absolute http(s) origins without a username, password, path, query, hash, or wildcard.";

function safeOriginDetail(value: string): string {
  if (value.includes("@") || /[\r\n]/.test(value) || value.length > 180) {
    return "a redacted value";
  }
  return JSON.stringify(value);
}

export function normalizeConfiguredOrigin(value: string): string {
  if (value.includes("*")) {
    throw new Error(
      `CORS allowlists cannot use wildcards (${safeOriginDetail(value)}). ${INVALID_ORIGIN}`,
    );
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Invalid CORS origin ${safeOriginDetail(value)}. ${INVALID_ORIGIN}`);
  }

  if (url.username || url.password || url.origin === "null") {
    throw new Error(`Invalid CORS origin ${safeOriginDetail(value)}. ${INVALID_ORIGIN}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Invalid CORS origin ${safeOriginDetail(value)}. ${INVALID_ORIGIN}`);
  }
  if ((url.pathname !== "/" && url.pathname !== "") || url.search || url.hash) {
    throw new Error(`Invalid CORS origin ${safeOriginDetail(value)}. ${INVALID_ORIGIN}`);
  }

  return url.origin;
}

function parseAllowedOrigins(value: string | undefined): Set<string> {
  if (value === undefined || value.trim() === "") return new Set();

  const origins = new Set<string>();
  for (const part of value.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    origins.add(normalizeConfiguredOrigin(trimmed));
  }
  if (origins.size === 0) {
    throw new Error(`CORS_ALLOWED_ORIGINS is set but contains no origins. ${INVALID_ORIGIN}`);
  }
  return origins;
}

function parsePreviewFlag(value: string | undefined): boolean | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw new Error('CORS_ALLOW_VERCEL_PREVIEWS must be "true" or "false" when set.');
}

function originFromVercelHost(value: string | undefined, name: string): string | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const trimmed = value.trim().replace(/\/+$/, "");
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    return normalizeConfiguredOrigin(withScheme);
  } catch {
    throw new Error(
      `${name} must be an http(s) host with no username, password, path, query, or hash.`,
    );
  }
}

export function resolveCorsPolicy(environment: CorsEnvironment = process.env): CorsPolicy {
  const configured = environment.CORS_ALLOWED_ORIGINS;
  const exactOrigins = parseAllowedOrigins(configured);
  const listWasSet = configured !== undefined && configured.trim() !== "";

  if (!listWasSet && environment.NODE_ENV === "development") {
    for (const origin of LOCAL_DEV_ORIGINS) exactOrigins.add(origin);
  }

  for (const key of VERCEL_HOST_KEYS) {
    const origin = originFromVercelHost(environment[key], key);
    if (origin) exactOrigins.add(origin);
  }

  const previewFlag = parsePreviewFlag(environment.CORS_ALLOW_VERCEL_PREVIEWS);
  const allowVercelPreviews = previewFlag ?? environment.VERCEL_ENV === "preview";

  return { exactOrigins, allowVercelPreviews };
}

function isVercelPreviewOrigin(origin: string): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.origin !== origin || url.protocol !== "https:") return false;
  return VERCEL_PREVIEW_HOSTNAME.test(url.hostname);
}

export function isOriginAllowed(origin: string, policy: CorsPolicy): boolean {
  if (policy.exactOrigins.has(origin)) return true;
  if (!policy.allowVercelPreviews) return false;
  return isVercelPreviewOrigin(origin);
}

export function createCorsMiddleware(environment: CorsEnvironment = process.env) {
  const policy = resolveCorsPolicy(environment);
  return cors({
    credentials: true,
    origin(requestOrigin, callback) {
      if (requestOrigin && isOriginAllowed(requestOrigin, policy)) {
        callback(null, requestOrigin);
        return;
      }
      callback(null, false);
    },
  });
}
