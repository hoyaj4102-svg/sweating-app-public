/** Only a class detail can be the destination of this explicit browse → login flow.
 * Parse the browser's RAW query once; never feed Wouter's decoded useSearch here.
 * Returning never joins a class: that still requires a separate user action.
 */
export function safeClassReturn(value: string | null | undefined): string | null {
  if (!value || value.length > 2048 || /\s/.test(value)) return null;
  return /^\/classes\/[A-Za-z0-9_-]{1,100}(\?[A-Za-z0-9%=&_.~+*-]*)?$/.test(value) ? value : null;
}

export function parseClassReturn(rawSearch: string): string | null {
  return safeClassReturn(new URLSearchParams(rawSearch).get("next"));
}

function withClassReturn(route: "/login" | "/profile", target: string) {
  const safe = safeClassReturn(target);
  return safe ? `${route}?next=${encodeURIComponent(safe)}` : route;
}

export const classLoginUrl = (target: string) => withClassReturn("/login", target);
export const classProfileUrl = (target: string) => withClassReturn("/profile", target);
