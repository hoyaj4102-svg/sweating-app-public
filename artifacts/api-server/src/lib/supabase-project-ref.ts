const PROJECT_REF = /^[a-z0-9]{20}$/;

/**
 * Project ref from a Supabase URL host (`https://<ref>.supabase.co`).
 * Returns null when the URL is missing, invalid, or not that host.
 * Credentials, paths, query strings, and API keys are never returned.
 */
export function supabaseProjectRef(supabaseUrl: string | undefined): string | null {
  if (!supabaseUrl || supabaseUrl.length > 300) return null;
  let url: URL;
  try {
    url = new URL(supabaseUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase();
  const suffix = ".supabase.co";
  if (!host.endsWith(suffix)) return null;
  const ref = host.slice(0, -suffix.length);
  if (!PROJECT_REF.test(ref)) return null;
  return ref;
}
