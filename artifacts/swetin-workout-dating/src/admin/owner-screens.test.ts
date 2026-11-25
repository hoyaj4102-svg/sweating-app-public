import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import type { Gym } from "@workspace/api-client-react";

const gym: Gym = {
  id: "10000000-0000-4000-8000-0000000000aa",
  name: "샘플 체육관",
  description: null,
  address: "예시시",
  city: "예시시",
  latitude: null,
  longitude: null,
  image_url: null,
  created_at: "2026-11-01T00:00:00.000Z",
};

function installWindow() {
  const window = new Window({ url: "http://localhost/", width: 1280, height: 900, settings: { disableJavaScriptEvaluation: true } });
  const globals = globalThis as typeof globalThis & Record<string, unknown>;
  for (const key of ["window", "document", "HTMLElement", "HTMLInputElement", "HTMLSelectElement", "HTMLTextAreaElement", "Element", "Node", "Event", "InputEvent"]) {
    try {
      globals[key] = window[key as "window"];
    } catch {
      // Node owns a few globals. The happy-dom window still exposes them.
    }
  }
  globals.IS_REACT_ACT_ENVIRONMENT = true;
  return window;
}

async function setControl(act, element, value) {
  await act(async () => {
    const view = element.ownerDocument.defaultView;
    const prototype = element.tagName === "SELECT"
      ? view.HTMLSelectElement.prototype
      : element.tagName === "TEXTAREA"
        ? view.HTMLTextAreaElement.prototype
        : view.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    setter?.call(element, value);
    element.dispatchEvent(new view.Event("input", { bubbles: true }));
    element.dispatchEvent(new view.Event("change", { bubbles: true }));
  });
}

test("admin gym desk creates a gym and assigns an owner without keeping the email", { concurrency: false }, async () => {
  const window = installWindow();
  const calls: Array<{ url: string; method: string; body: string | null }> = [];
  const fetchMock = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? init.body : null;
    calls.push({ url, method, body });
    if (method === "GET") return new window.Response(JSON.stringify({ owner: null }), { status: 200 });
    if (url.endsWith("/owner")) {
      return new window.Response(JSON.stringify({ owner: { user_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1", display_name: "호스트" } }), { status: 201 });
    }
    return new window.Response(JSON.stringify({ id: gym.id, name: "새로 연 체육관" }), { status: 201 });
  };
  const previousFetch = globalThis.fetch;
  window.fetch = fetchMock;
  globalThis.fetch = fetchMock;
  const [{ createElement, act }, { createRoot }, { GymDesk }] = await Promise.all([
    import("react"),
    import("react-dom/client"),
    import("./GymDesk.tsx"),
  ]);
  const rootEl = window.document.createElement("div");
  window.document.body.appendChild(rootEl);
  const root = createRoot(rootEl);
  let changed = 0;
  await act(async () => {
    root.render(createElement(GymDesk, { gyms: [gym], onChanged: () => { changed += 1; } }));
    await Promise.resolve();
  });
  try {
    const name = window.document.querySelector("[data-testid='input-gym-name']") as HTMLInputElement;
    const city = window.document.querySelector("[data-testid='input-gym-city']") as HTMLInputElement;
    const address = window.document.querySelector("[data-testid='input-gym-address']") as HTMLInputElement;
    await setControl(act, name, "새로 연 체육관");
    await setControl(act, city, "예시시");
    await setControl(act, address, "예시 해변");
    await act(async () => {
      (window.document.querySelector("[data-testid='button-create-gym']") as HTMLButtonElement).click();
      await Promise.resolve();
    });
    const created = calls.find((call) => call.method === "POST" && call.url.endsWith("/api/admin/gyms"));
    assert.ok(created);
    assert.deepEqual(JSON.parse(created.body ?? ""), {
      name: "새로 연 체육관",
      city: "예시시",
      address: "예시 해변",
      description: null,
      latitude: null,
      longitude: null,
      image_url: null,
    });
    assert.equal(changed, 1);

    await setControl(act, window.document.querySelector("[data-testid='input-owner-email']") as HTMLInputElement, "host@example.com");
    await act(async () => {
      (window.document.querySelector("[data-testid='button-assign-owner']") as HTMLButtonElement).click();
      await Promise.resolve();
    });
    const assigned = calls.find((call) => call.method === "POST" && call.url.endsWith("/owner"));
    assert.ok(assigned);
    assert.deepEqual(JSON.parse(assigned.body ?? ""), { email: "host@example.com" });
    assert.equal((window.document.querySelector("[data-testid='input-owner-email']") as HTMLInputElement).value, "");
    assert.match(window.document.querySelector("[data-testid='owner-current']")?.textContent ?? "", /호스트/);
    assert.doesNotMatch(window.document.body.textContent ?? "", /host@example.com/);
  } finally {
    await act(async () => {
      root.unmount();
    });
    globalThis.fetch = previousFetch;
    window.close();
  }
});

test("owner class form sends duration, capacity, age band, and visibility for its gym", { concurrency: false }, async () => {
  const window = installWindow();
  const calls: Array<{ url: string; method: string; body: string | null }> = [];
  const fetchMock = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? init.body : null;
    calls.push({ url, method, body });
    if (method === "GET") return new window.Response("[]", { status: 200 });
    return new window.Response(JSON.stringify({ id: "class" }), { status: 201 });
  };
  const previousFetch = globalThis.fetch;
  window.fetch = fetchMock;
  globalThis.fetch = fetchMock;
  const [{ createElement, act }, { createRoot }, { OwnerScreen }] = await Promise.all([
    import("react"),
    import("react-dom/client"),
    import("../owner/OwnerScreen.tsx"),
  ]);
  const rootEl = window.document.createElement("div");
  window.document.body.appendChild(rootEl);
  const root = createRoot(rootEl);
  const Shell = ({ children }: { children: import("react").ReactNode }) => createElement("div", null, children);
  await act(async () => {
    root.render(createElement(OwnerScreen, { Shell, initialGyms: [gym] }));
    await Promise.resolve();
  });
  try {
    await setControl(act, window.document.querySelector("[data-testid='input-class-title']") as HTMLInputElement, "저녁 러닝");
    await setControl(act, window.document.querySelector("[data-testid='input-class-when']") as HTMLInputElement, "2026-12-01T19:00");
    await setControl(act, window.document.querySelector("[data-testid='input-class-duration']") as HTMLInputElement, "75");
    await setControl(act, window.document.querySelector("[data-testid='input-class-capacity']") as HTMLInputElement, "12");
    await setControl(act, window.document.querySelector("[data-testid='select-owner-age-band']") as HTMLSelectElement, "36_45");
    await setControl(act, window.document.querySelector("[data-testid='select-owner-visibility']") as HTMLSelectElement, "draft");
    await act(async () => {
      (window.document.querySelector("[data-testid='button-create-class']") as HTMLButtonElement).click();
      await Promise.resolve();
    });
    const created = calls.find((call) => call.method === "POST" && call.url === "/api/owner/classes");
    assert.ok(created);
    const payload = JSON.parse(created.body ?? "") as {
      gym_id: string;
      title: string;
      duration_minutes: number;
      capacity: number;
      age_band: string;
      status: string;
    };
    assert.equal(payload.gym_id, gym.id);
    assert.equal(payload.title, "저녁 러닝");
    assert.equal(payload.duration_minutes, 75);
    assert.equal(payload.capacity, 12);
    assert.equal(payload.age_band, "36_45");
    assert.equal(payload.status, "draft");
    assert.equal(Object.hasOwn(payload, "email"), false);
  } finally {
    await act(async () => {
      root.unmount();
    });
    globalThis.fetch = previousFetch;
    window.close();
  }
});
