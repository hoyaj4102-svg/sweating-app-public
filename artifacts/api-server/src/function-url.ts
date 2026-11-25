/**
 * Every `/api/**` request is handled by `api/index.mjs`.
 * Vercel may pass the original path (`/api/...`), the path after the `/api`
 * mount, or the rewrite destination `/api` with the nested suffix in the
 * `path` query (`/api?path=auth/session`). Express routes are mounted at `/api`.
 */
export function normalizeFunctionUrl(url: string | undefined): string {
  const raw = url && url.length > 0 ? url : "/";
  const hashIndex = raw.indexOf("#");
  const withoutHash = hashIndex === -1 ? raw : raw.slice(0, hashIndex);
  const queryIndex = withoutHash.indexOf("?");
  const path = queryIndex === -1 ? withoutHash : withoutHash.slice(0, queryIndex);
  const query = queryIndex === -1 ? "" : withoutHash.slice(queryIndex);
  const lifted = liftCollapsedApiPath(path, query);

  if (lifted.path === "/api" || lifted.path.startsWith("/api/")) {
    return `${lifted.path}${lifted.query}`;
  }

  const suffix = lifted.path.startsWith("/") ? lifted.path : `/${lifted.path}`;
  if (suffix === "/") return `/api${lifted.query}`;
  return `/api${suffix}${lifted.query}`;
}

/**
 * The `/api/:path*` rewrite targets the `/api` function. Unused named params
 * are copied onto the destination query, so a collapsed URL looks like
 * `/api?path=auth/session`. Put that suffix back on the pathname and drop the
 * synthetic parameter. Leave a real `/api/...` path, and any other query, alone.
 */
function liftCollapsedApiPath(path: string, query: string): { path: string; query: string } {
  if ((path !== "/api" && path !== "/api/") || !query.startsWith("?")) {
    return { path, query };
  }

  const params = new URLSearchParams(query.slice(1));
  const captured = params.get("path");
  if (captured == null || !isApiPathSuffix(captured)) {
    return { path, query };
  }

  params.delete("path");
  const rest = params.toString();
  const suffix = captured.replace(/^\/+|\/+$/g, "");
  return {
    path: `/api/${suffix}`,
    query: rest.length > 0 ? `?${rest}` : "",
  };
}

function isApiPathSuffix(value: string): boolean {
  const suffix = value.replace(/^\/+|\/+$/g, "");
  if (suffix.length === 0) return false;
  return suffix.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}
