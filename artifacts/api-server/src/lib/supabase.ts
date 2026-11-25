import { recordSupabaseRoundTrip } from "./request-timing";

function requireSupabaseUrl(): string {
  const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  if (!supabaseUrl) {
    throw new Error("SUPABASE_URL is required for server-side Supabase operations.");
  }
  return supabaseUrl;
}

function requireSupabaseAnonKey(): string {
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!anonKey) {
    throw new Error("SUPABASE_ANON_KEY is required for server-side Supabase operations.");
  }
  return anonKey;
}

export async function supabaseRequest(
  path: string,
  init: RequestInit = {},
  accessToken?: string,
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  const anonKey = requireSupabaseAnonKey();
  headers.set("apikey", anonKey);
  headers.set("Authorization", `Bearer ${accessToken || anonKey}`);

  return measureSupabaseFetch(path, () => fetch(`${requireSupabaseUrl()}${path}`, {
    ...init,
    headers,
  }));
}

export async function supabaseJson<T>(
  path: string,
  init: RequestInit = {},
  accessToken?: string,
): Promise<T> {
  const response = await supabaseRequest(path, init, accessToken);
  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!response.ok) {
    const detail =
      typeof payload === "object" && payload !== null && "message" in payload
        ? String((payload as { message: unknown }).message)
        : `Supabase request failed with ${response.status}`;
    const error = new Error(detail);
    Object.assign(error, { status: response.status, payload });
    throw error;
  }

  return payload as T;
}

export async function supabaseServiceJson<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const serviceRoleKey = getSupabaseServiceRoleKey();
  const supabaseUrl = requireSupabaseUrl();

  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  headers.set("apikey", serviceRoleKey);
  headers.set("Authorization", `Bearer ${serviceRoleKey}`);

  const response = await measureSupabaseFetch(path, () => fetch(`${supabaseUrl}${path}`, {
    ...init,
    headers,
  }));
  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!response.ok) {
    const detail =
      typeof payload === "object" && payload !== null && "message" in payload
        ? String((payload as { message: unknown }).message)
        : `Supabase request failed with ${response.status}`;
    const error = new Error(detail);
    Object.assign(error, { status: response.status, payload });
    throw error;
  }

  return payload as T;
}

export function supabaseBody(body: unknown): RequestInit {
  return {
    body: JSON.stringify(body),
    headers: {
      Prefer: "return=representation",
    },
  };
}

export async function measureSupabaseFetch(
  path: string,
  run: () => Promise<Response>,
): Promise<Response> {
  const started = performance.now();
  try {
    return await run();
  } finally {
    recordSupabaseRoundTrip(path, performance.now() - started);
  }
}

export function getSupabaseServiceRoleKey(): string {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for server-side Supabase operations.");
  }
  return serviceRoleKey;
}
