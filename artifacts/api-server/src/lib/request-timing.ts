import { AsyncLocalStorage } from "node:async_hooks";

export type TimingBuckets = {
  authMs: number;
  authCount: number;
  dbMs: number;
  dbCount: number;
};

export type RequestTimingState = {
  started: number;
  totalMs?: number;
  buckets: TimingBuckets;
};

const requestTiming = new AsyncLocalStorage<TimingBuckets>();
const states = new WeakMap<object, RequestTimingState>();

const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

export function emptyBuckets(): TimingBuckets {
  return { authMs: 0, authCount: 0, dbMs: 0, dbCount: 0 };
}

export function beginRequestTiming(): RequestTimingState {
  return { started: performance.now(), buckets: emptyBuckets() };
}

export function bindTiming(response: object, state: RequestTimingState): void {
  states.set(response, state);
}

export function timingStateFor(response: object): RequestTimingState | undefined {
  return states.get(response);
}

export function runWithTiming<T>(buckets: TimingBuckets, fn: () => T): T {
  return requestTiming.run(buckets, fn);
}

export function roundMs(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.round(value * 10) / 10;
}

/** Auth is `/auth/*`. Every other Supabase HTTP call counts as a database round trip. */
export function recordSupabaseRoundTrip(path: string, elapsedMs: number): void {
  const buckets = requestTiming.getStore();
  if (!buckets) return;
  const ms = Number.isFinite(elapsedMs) && elapsedMs > 0 ? elapsedMs : 0;
  const pathname = path.split("?")[0] ?? path;
  if (pathname === "/auth" || pathname.startsWith("/auth/")) {
    buckets.authMs += ms;
    buckets.authCount += 1;
    return;
  }
  buckets.dbMs += ms;
  buckets.dbCount += 1;
}

export function scrubLogPath(url: string | undefined): string {
  const raw = (url ?? "").split("?")[0]?.split("#")[0] ?? "";
  const scrubbed = raw.replace(UUID_PATTERN, ":id").replace(EMAIL_PATTERN, ":email");
  if (scrubbed.length > 180) return scrubbed.slice(0, 180);
  return scrubbed || "/";
}

/** Production deployments omit the header. Preview, development, and an unset env keep it. */
export function serverTimingEnabled(env: { VERCEL_ENV?: string } = process.env): boolean {
  return env.VERCEL_ENV !== "production";
}

export function serverTimingHeader(buckets: TimingBuckets, totalMs: number): string {
  return [
    `auth;dur=${roundMs(buckets.authMs).toFixed(1)};desc="n=${buckets.authCount}"`,
    `db;dur=${roundMs(buckets.dbMs).toFixed(1)};desc="n=${buckets.dbCount}"`,
    `total;dur=${roundMs(totalMs).toFixed(1)}`,
  ].join(", ");
}

export function timingLogFields(input: {
  path: string;
  buckets: TimingBuckets;
  totalMs: number;
}): {
  path: string;
  auth_ms: number;
  auth_roundtrips: number;
  db_ms: number;
  db_roundtrips: number;
  total_ms: number;
} {
  return {
    path: scrubLogPath(input.path),
    auth_ms: roundMs(input.buckets.authMs),
    auth_roundtrips: input.buckets.authCount,
    db_ms: roundMs(input.buckets.dbMs),
    db_roundtrips: input.buckets.dbCount,
    total_ms: roundMs(input.totalMs),
  };
}

type HeaderResponse = {
  headersSent: boolean;
  setHeader: (name: string, value: string) => void;
  writeHead: (...args: unknown[]) => unknown;
  end: (...args: unknown[]) => unknown;
};

export function stampServerTiming(response: object, header: () => string | null): void {
  const target = response as HeaderResponse;
  const apply = () => {
    const value = header();
    if (value !== null && !target.headersSent) target.setHeader("Server-Timing", value);
  };
  const writeHead = target.writeHead;
  target.writeHead = function (...args: unknown[]) {
    apply();
    return Reflect.apply(writeHead, target, args);
  };

  const end = target.end;
  target.end = function (...args: unknown[]) {
    apply();
    return Reflect.apply(end, target, args);
  };
}
