import { useEffect } from "react";

function setTag(attr: "name" | "property", key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!el) { el = document.createElement("meta"); el.setAttribute(attr, key); document.head.appendChild(el); }
  el.setAttribute("content", content);
}

/** Local per-page metadata. No published URL is invented. */
export function usePageMeta(title: string, description: string) {
  useEffect(() => {
    const prev = document.title;
    const tags = [["name", "description", description], ["property", "og:title", title], ["property", "og:description", description], ["property", "og:type", "website"]] as const;
    const original = tags.map(([attr, key]) => ({ attr, key, content: document.head.querySelector(`meta[${attr}="${key}"]`)?.getAttribute("content") ?? null }));
    document.title = title;
    setTag("name", "description", description);
    setTag("property", "og:title", title);
    setTag("property", "og:description", description);
    setTag("property", "og:type", "website");
    return () => {
      document.title = prev;
      for (const { attr, key, content } of original) {
        if (content !== null) setTag(attr, key, content);
        else document.head.querySelector(`meta[${attr}="${key}"]`)?.remove();
      }
    };
  }, [title, description]);
}
