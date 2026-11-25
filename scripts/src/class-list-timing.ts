export type Summary = {
  n: number;
  p50: number;
  p95: number;
  mean: number;
};

export type ServerTimingMetric = {
  dur: number;
  desc: string | null;
};

export type Attribution = "unknown" | "db_roundtrip" | "outside_db" | "mixed";

export type MeasureReport = {
  outcome: "measured" | "unknown";
  host: "loopback" | "vercel.app";
  region: string | null;
  cache: string | null;
  samples: number;
  warmup_excluded: number;
  http_status: number | null;
  reason: string | null;
  client_ms: Summary | null;
  server_total_ms: Summary | null;
  auth_ms: Summary | null;
  db_ms: Summary | null;
  db_roundtrips: number | null;
  auth_roundtrips: number | null;
  attribution: Attribution;
  db_ms_includes: "function_to_supabase_network_plus_query";
};

const CACHE_TOKENS = new Set(["HIT", "MISS", "BYPASS", "STALE", "PRERENDER", "REVALIDATED"]);
const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1"]);

export function roundMs(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.round(value * 10) / 10;
}

export function summarize(values: readonly number[]): Summary {
  if (values.length === 0) throw new Error("No samples.");
  const sorted = [...values].sort((left, right) => left - right);
  const mean = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  return {
    n: sorted.length,
    mean: roundMs(mean),
    p50: roundMs(nearestRank(sorted, 50)),
    p95: roundMs(nearestRank(sorted, 95)),
  };
}

function nearestRank(sorted: readonly number[], percentile: number): number {
  const rank = Math.ceil((percentile / 100) * sorted.length);
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[index] ?? 0;
}

export function classListUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("The class list URL is invalid.");
  }
  if (url.username || url.password) throw new Error("Credentials in the URL are not allowed.");
  if (url.search || url.hash) throw new Error("Only /api/classes with no query string is allowed.");
  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (path !== "/api/classes") throw new Error("Only GET /api/classes is allowed.");
  const host = url.hostname.toLowerCase();
  if (LOOPBACK.has(host)) {
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("Loopback measurement must use http or https.");
    }
  } else if (url.protocol !== "https:" || !host.endsWith(".vercel.app") || host.includes("..")) {
    throw new Error("Remote measurement only allows https://*.vercel.app/api/classes.");
  }
  url.hash = "";
  url.search = "";
  url.username = "";
  url.password = "";
  return url;
}

export function hostLabel(url: URL): MeasureReport["host"] {
  const host = url.hostname.toLowerCase();
  if (LOOPBACK.has(host)) return "loopback";
  return "vercel.app";
}

export function readOnlyClassListRequest(url: URL): {
  url: string;
  method: "GET";
  headers: { accept: string; "cache-control": string };
} {
  return {
    url: url.toString(),
    method: "GET",
    headers: {
      accept: "application/json",
      "cache-control": "no-cache",
    },
  };
}

export function parseServerTiming(header: string | null): Record<string, ServerTimingMetric> {
  const metrics: Record<string, ServerTimingMetric> = {};
  if (!header) return metrics;
  for (const part of splitTiming(header)) {
    const bits = part.trim().split(";").map((bit) => bit.trim()).filter(Boolean);
    const name = bits[0] ?? "";
    if (!/^[A-Za-z0-9_-]+$/.test(name)) continue;
    let dur = Number.NaN;
    let desc: string | null = null;
    for (const bit of bits.slice(1)) {
      const separator = bit.indexOf("=");
      if (separator === -1) continue;
      const key = bit.slice(0, separator).trim();
      const value = bit.slice(separator + 1).trim();
      if (key === "dur") dur = Number(value);
      if (key === "desc") desc = unquote(value);
    }
    if (!Number.isFinite(dur) || dur < 0) continue;
    metrics[name] = { dur, desc };
  }
  return metrics;
}

function splitTiming(header: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quoted = false;
  for (const char of header) {
    if (char === "\"") quoted = !quoted;
    if (char === "," && !quoted) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) parts.push(current);
  return parts;
}

function unquote(value: string): string {
  if (value.startsWith("\"") && value.endsWith("\"") && value.length >= 2) {
    return value.slice(1, -1);
  }
  return value;
}

export function regionFromVercelId(value: string | null): string | null {
  if (!value) return null;
  const label = value.split(":")[0]?.trim().toLowerCase() ?? "";
  return /^[a-z]{3}\d$/.test(label) ? label : null;
}

export function cacheToken(value: string | null): string | null {
  if (!value) return null;
  const token = value.trim().toUpperCase();
  return CACHE_TOKENS.has(token) ? token : "other";
}

export function roundtripCount(desc: string | null): number | null {
  if (!desc) return null;
  const match = /^n=(\d+)$/.exec(desc);
  if (!match) return null;
  return Number(match[1]);
}

export function attributeLatency(clientMean: number | null, dbMean: number | null): Attribution {
  if (clientMean === null || dbMean === null || clientMean <= 0) return "unknown";
  const share = dbMean / clientMean;
  if (share >= 0.6) return "db_roundtrip";
  if (share <= 0.3) return "outside_db";
  return "mixed";
}

export function blockedReason(status: number, contentType: string, location: string | null): string | null {
  if (location) return "redirect";
  if (status === 401 || status === 403) return "auth_wall";
  if (status !== 200) return "http_status";
  if (!contentType.toLowerCase().includes("application/json")) return "not_json";
  return null;
}

export type Sample = {
  clientMs: number;
  totalMs: number | null;
  authMs: number | null;
  dbMs: number | null;
  authRoundtrips: number | null;
  dbRoundtrips: number | null;
  region: string | null;
  cache: string | null;
  status: number;
};

export function reportFromSamples(input: {
  url: URL;
  samples: readonly Sample[];
  warmupExcluded: number;
}): MeasureReport {
  const rows = input.samples;
  const client = rows.map((row) => row.clientMs);
  const total = numbers(rows.map((row) => row.totalMs));
  const auth = numbers(rows.map((row) => row.authMs));
  const db = numbers(rows.map((row) => row.dbMs));
  const dbSummary = db.length === rows.length && db.length > 0 ? summarize(db) : null;
  const clientSummary = client.length > 0 ? summarize(client) : null;
  const first = rows[0];
  return {
    outcome: "measured",
    host: hostLabel(input.url),
    region: first?.region ?? null,
    cache: first?.cache ?? null,
    samples: rows.length,
    warmup_excluded: input.warmupExcluded,
    http_status: first?.status ?? null,
    reason: null,
    client_ms: clientSummary,
    server_total_ms: total.length === rows.length && total.length > 0 ? summarize(total) : null,
    auth_ms: auth.length === rows.length && auth.length > 0 ? summarize(auth) : null,
    db_ms: dbSummary,
    db_roundtrips: first?.dbRoundtrips ?? null,
    auth_roundtrips: first?.authRoundtrips ?? null,
    attribution: attributeLatency(clientSummary?.mean ?? null, dbSummary?.mean ?? null),
    db_ms_includes: "function_to_supabase_network_plus_query",
  };
}

function numbers(values: readonly (number | null)[]): number[] {
  const out: number[] = [];
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) out.push(value);
  }
  return out;
}

export function unknownReport(url: URL, status: number | null, reason: string): MeasureReport {
  return {
    outcome: "unknown",
    host: hostLabel(url),
    region: null,
    cache: null,
    samples: 0,
    warmup_excluded: 0,
    http_status: status,
    reason,
    client_ms: null,
    server_total_ms: null,
    auth_ms: null,
    db_ms: null,
    db_roundtrips: null,
    auth_roundtrips: null,
    attribution: "unknown",
    db_ms_includes: "function_to_supabase_network_plus_query",
  };
}

export function parseSample(input: {
  status: number;
  contentType: string | null;
  location: string | null;
  serverTiming: string | null;
  vercelId: string | null;
  vercelCache: string | null;
  clientMs: number;
}): { blocked: string | null; sample: Sample | null } {
  const blocked = blockedReason(input.status, input.contentType ?? "", input.location);
  if (blocked) return { blocked, sample: null };
  const timing = parseServerTiming(input.serverTiming);
  return {
    blocked: null,
    sample: {
      clientMs: input.clientMs,
      totalMs: timing.total?.dur ?? null,
      authMs: timing.auth?.dur ?? null,
      dbMs: timing.db?.dur ?? null,
      authRoundtrips: roundtripCount(timing.auth?.desc ?? null),
      dbRoundtrips: roundtripCount(timing.db?.desc ?? null),
      region: regionFromVercelId(input.vercelId),
      cache: cacheToken(input.vercelCache),
      status: input.status,
    },
  };
}

const FORBIDDEN_FLAGS = new Set([
  "--method",
  "--data",
  "--header",
  "--cookie",
  "-X",
  "-d",
  "-H",
  "--request",
]);

export function parseCli(argv: readonly string[], env: NodeJS.ProcessEnv): {
  before?: string;
  after?: string;
  samples: number;
} {
  for (const arg of argv) {
    const name = arg.split("=")[0] ?? arg;
    if (FORBIDDEN_FLAGS.has(arg) || FORBIDDEN_FLAGS.has(name)) {
      throw new Error("This script only sends anonymous GET /api/classes.");
    }
  }
  let before = env.MEASURE_BEFORE_URL;
  let after = env.MEASURE_AFTER_URL;
  let samples = Number(env.MEASURE_SAMPLES ?? "15");
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? "";
    const next = argv[index + 1];
    if (arg === "--before" && next) {
      before = next;
      index += 1;
    } else if (arg === "--after" && next) {
      after = next;
      index += 1;
    } else if (arg === "--samples" && next) {
      samples = Number(next);
      index += 1;
    } else if (arg.startsWith("--before=")) {
      before = arg.slice("--before=".length);
    } else if (arg.startsWith("--after=")) {
      after = arg.slice("--after=".length);
    } else if (arg.startsWith("--samples=")) {
      samples = Number(arg.slice("--samples=".length));
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown option ${arg.split("=")[0]}.`);
    }
  }
  if (!Number.isInteger(samples) || samples < 1 || samples > 30) {
    throw new Error("Sample count must be an integer from 1 to 30.");
  }
  if (!before && !after) throw new Error("Pass --before and/or --after with a /api/classes URL.");
  return { before, after, samples };
}

export async function measureClassList(
  rawUrl: string,
  options: {
    samples: number;
    fetchImpl?: typeof fetch;
    pauseMs?: number;
    now?: () => number;
  },
): Promise<MeasureReport> {
  const url = classListUrl(rawUrl);
  const fetchImpl = options.fetchImpl ?? fetch;
  const pauseMs = options.pauseMs ?? 0;
  const now = options.now ?? (() => performance.now());
  const planned = readOnlyClassListRequest(url);
  if (planned.method !== "GET") throw new Error("Only GET is allowed.");
  const samples: Sample[] = [];
  const attempts = options.samples + 1;
  for (let index = 0; index < attempts; index += 1) {
    if (index > 0 && pauseMs > 0) await delay(pauseMs);
    const started = now();
    let response: Response;
    try {
      response = await fetchImpl(planned.url, {
        method: "GET",
        headers: planned.headers,
        redirect: "manual",
      });
    } catch {
      return unknownReport(url, null, "request_failed");
    }
    const clientMs = Math.max(0, now() - started);
    const parsed = parseSample({
      status: response.status,
      contentType: response.headers.get("content-type"),
      location: response.headers.get("location"),
      serverTiming: response.headers.get("server-timing"),
      vercelId: response.headers.get("x-vercel-id"),
      vercelCache: response.headers.get("x-vercel-cache"),
      clientMs,
    });
    await response.arrayBuffer().catch(() => undefined);
    if (parsed.blocked) return unknownReport(url, response.status, parsed.blocked);
    if (!parsed.sample) return unknownReport(url, response.status, "unreadable");
    if (index > 0) samples.push(parsed.sample);
  }
  return reportFromSamples({ url, samples, warmupExcluded: 1 });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
