import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";

function installWindow() {
  const window = new Window({ url: "http://localhost/", width: 1280, height: 900, settings: { disableJavaScriptEvaluation: true } });
  const globals = globalThis as typeof globalThis & Record<string, unknown>;
  for (const key of ["window", "document", "HTMLElement", "HTMLInputElement", "HTMLTextAreaElement", "Element", "Node", "Event", "InputEvent"]) {
    try {
      globals[key] = window[key as "window"];
    } catch {
      // Node owns a few globals. The happy-dom window still exposes them.
    }
  }
  globals.IS_REACT_ACT_ENVIRONMENT = true;
  return window;
}

async function setControl(act: typeof import("react").act, element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => {
    const view = element.ownerDocument.defaultView;
    const prototype = element.tagName === "TEXTAREA" ? view?.HTMLTextAreaElement.prototype : view?.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype ?? {}, "value")?.set;
    setter?.call(element, value);
    element.dispatchEvent(new (view as Window).Event("input", { bubbles: true }));
    element.dispatchEvent(new (view as Window).Event("change", { bubbles: true }));
  });
}

test("admin publishes an owner notice with title and body only", { concurrency: false }, async () => {
  const window = installWindow();
  const calls: Array<{ url: string; method: string; body: string | null }> = [];
  const fetchMock = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? init.body : null;
    calls.push({ url, method, body });
    if (method === "GET") {
      return new window.Response(JSON.stringify({
        announcements: calls.some((call) => call.method === "POST")
          ? [{ title: "시설 점검", body: "이번 주 시설 점검이 있습니다.", published_at: "2026-11-12T10:00:00.000Z", notice_version: "owner-notice-fixture" }]
          : [],
      }), { status: 200 });
    }
    return new window.Response(JSON.stringify({
      announcement: { title: "시설 점검", body: "이번 주 시설 점검이 있습니다.", notice_version: "owner-notice-fixture" },
    }), { status: 201 });
  };
  const previous = globalThis.fetch;
  window.fetch = fetchMock;
  globalThis.fetch = fetchMock;
  const [{ createElement, act }, { createRoot }, { OwnerNotices }] = await Promise.all([
    import("react"),
    import("react-dom/client"),
    import("./OwnerNotices.tsx"),
  ]);
  const rootEl = window.document.createElement("div");
  window.document.body.appendChild(rootEl);
  const root = createRoot(rootEl);
  try {
    await act(async () => {
      root.render(createElement(OwnerNotices));
      await Promise.resolve();
    });
    await setControl(act, window.document.querySelector("[data-testid='input-notice-title']") as HTMLInputElement, "시설 점검");
    await setControl(act, window.document.querySelector("[data-testid='input-notice-body']") as HTMLTextAreaElement, "이번 주 시설 점검이 있습니다.");
    await act(async () => {
      (window.document.querySelector("[data-testid='button-publish-notice']") as HTMLButtonElement).click();
      await Promise.resolve();
    });
    const created = calls.find((call) => call.method === "POST");
    assert.ok(created);
    assert.equal(created.url, "/api/admin/announcements");
    assert.deepEqual(JSON.parse(created.body ?? ""), {
      title: "시설 점검",
      body: "이번 주 시설 점검이 있습니다.",
    });
    assert.match(window.document.querySelector("[data-testid='list-owner-notices']")?.textContent ?? "", /시설 점검/);
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = previous;
    window.close();
  }
});
