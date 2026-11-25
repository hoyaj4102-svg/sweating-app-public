const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"] as const;
/** Bounded tracking data, not arbitrary query forwarding or a redirect validator. */
export function campaignParams(rawSearch: string): URLSearchParams {
  const source = new URLSearchParams(rawSearch);
  const out = new URLSearchParams();
  for (const key of UTM_KEYS) {
    let value = (source.get(key) ?? "").slice(0, 80);
    if (!value || /[\u0000-\u001f\u007f]/.test(value)) continue;
    out.set(key, value);
    while (value && out.toString().length > 360) {
      value = value.slice(0, -1);
      if (value) out.set(key, value); else out.delete(key);
    }
  }
  return out;
}
export function withCampaign(path: string, rawSearch: string): string {
  if (!/^\/(?:home|about|partners|start|login|signup|preview\/(?:workout|wallet|interests)|classes\/[A-Za-z0-9_-]{1,100})?(?:\?[A-Za-z0-9%=&_.~+*-]*)?$/.test(path)) {
    throw new Error("Only known internal campaign destinations are allowed");
  }
  const question = path.indexOf("?");
  const base = question < 0 ? path : path.slice(0, question);
  const target = new URLSearchParams(question < 0 ? "" : path.slice(question + 1));
  for (const [key, value] of campaignParams(rawSearch)) target.set(key, value);
  const query = target.toString();
  return query ? `${base}?${query}` : base;
}
