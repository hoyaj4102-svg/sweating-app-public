/** Suggested performance sample. About one trace in ten while a DSN is configured. */
export const SUGGESTED_TRACES_SAMPLE_RATE = 0.1;

const SENTRY_ENVIRONMENTS = ["production", "preview", "development"] as const;

export type SentryEnvironment = (typeof SENTRY_ENVIRONMENTS)[number];

export type SentryRuntimeOptions = {
  enabled: boolean;
  dsn?: string;
  environment: SentryEnvironment;
  release?: string;
  sendDefaultPii: false;
  tracesSampleRate: number;
  enableLogs: false;
  includeLocalVariables: false;
  replaysSessionSampleRate: 0;
  replaysOnErrorSampleRate: 0;
};

/**
 * Sentry environment comes only from Vercel's `VERCEL_ENV`.
 * A hostname such as `app.example.com` is not an input, so a `*.vercel.app`
 * rule cannot mark the production origin as preview.
 * When the variable is missing, the label is `development` because the SDK
 * would otherwise default the event to `production`.
 */
export function sentryEnvironment(vercelEnv: string | undefined): SentryEnvironment {
  if (vercelEnv === "production" || vercelEnv === "preview" || vercelEnv === "development") {
    return vercelEnv;
  }
  return "development";
}

export function readDsn(value: string | undefined): string | undefined {
  const dsn = value?.trim();
  return dsn ? dsn : undefined;
}

export function buildSentryRuntimeOptions(input: {
  dsn: string | undefined;
  vercelEnv: string | undefined;
  release: string | undefined;
}): SentryRuntimeOptions {
  const dsn = readDsn(input.dsn);
  const release = input.release?.trim();
  return {
    enabled: Boolean(dsn),
    dsn,
    environment: sentryEnvironment(input.vercelEnv),
    release: release || undefined,
    sendDefaultPii: false,
    tracesSampleRate: SUGGESTED_TRACES_SAMPLE_RATE,
    enableLogs: false,
    includeLocalVariables: false,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
  };
}

const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

function randomByte(): number {
  const cryptoApi = (globalThis as { crypto?: { getRandomValues(bytes: Uint8Array): Uint8Array } }).crypto;
  if (!cryptoApi) {
    throw new Error("Web Crypto is required to create an internal Sentry id.");
  }
  const bytes = new Uint8Array(1);
  cryptoApi.getRandomValues(bytes);
  return bytes[0] ?? 0;
}

/** Opaque per-process id. Not an account id, email, or UUID. */
export function createInternalUserId(nextByte: () => number = randomByte): string {
  let id = "anon-";
  for (let index = 0; index < 16; index += 1) {
    const byte = nextByte();
    if (!Number.isInteger(byte) || byte < 0 || byte > 255) {
      throw new Error("Internal id source failed.");
    }
    id += ID_ALPHABET[byte % ID_ALPHABET.length];
  }
  return id;
}
