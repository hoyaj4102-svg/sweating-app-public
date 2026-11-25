import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Window } from "happy-dom";
import { currentUnackedPrinciples, formatAcknowledgedAt, readInbox, type InboxAnnouncement } from "./inbox.ts";

const principles: InboxAnnouncement = {
  kind: "principles",
  title: "SWEATING 제휴 체육관 운영 원칙 — 운동으로 시작하는 자연스러운 만남",
  body: "첫째 문단입니다.\n\n둘째 문단입니다.",
  published_at: "2026-11-12T09:10:00.000Z",
  notice_version: "owner-principles-2026-11-12",
  is_current: true,
  acknowledged_at: null,
};

const css = readFileSync(new URL("../index.css", import.meta.url), "utf8").replace(/^@import[^;]*;/gm, "");

function installWindow() {
  const window = new Window({
    url: "http://localhost/",
    width: 1280,
    height: 900,
    settings: { disableJavaScriptEvaluation: true, disableCSSFileLoading: true },
  });
  const globals = globalThis as typeof globalThis & Record<string, unknown>;
  for (const key of ["window", "document", "HTMLElement", "HTMLDialogElement", "HTMLButtonElement", "Element", "Node", "Event", "KeyboardEvent", "MouseEvent"]) {
    try {
      globals[key] = window[key as "window"];
    } catch {
      // Node owns a few globals. The happy-dom window still exposes them.
    }
  }
  globals.IS_REACT_ACT_ENVIRONMENT = true;
  globals.location = window.location;
  globals.history = window.history;
  globals.addEventListener = window.addEventListener.bind(window);
  globals.removeEventListener = window.removeEventListener.bind(window);
  const style = window.document.createElement("style");
  style.textContent = css;
  window.document.head.appendChild(style);
  return window;
}

test("acknowledgement time is shown in Seoul and only an unacked current principles row blocks", () => {
  assert.match(formatAcknowledgedAt("2026-11-12T09:10:00.000Z"), /2026/);
  assert.match(formatAcknowledgedAt("2026-11-12T09:10:00.000Z"), /18:10/);
  assert.equal(currentUnackedPrinciples(readInbox({ announcements: [principles] }))?.notice_version, principles.notice_version);
  assert.equal(currentUnackedPrinciples([{ ...principles, acknowledged_at: "2026-11-12T09:20:00.000Z" }]), null);
  assert.equal(currentUnackedPrinciples([{ ...principles, is_current: false }]), null);
});

test("the principles dialog blocks until the server stores the acknowledgement", { concurrency: false }, async () => {
  const source = readFileSync(new URL("./PrinciplesGate.tsx", import.meta.url), "utf8");
  const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  assert.equal(source.includes("is_admin"), false);
  assert.match(app, /\{session \? <PrinciplesGate \/> : null\}/);
  assert.match(app, /path="\/messages"/);
  assert.match(css, /dialog\.principles-gate\s*\{[^}]*position:\s*fixed;/);
  assert.match(css, /dialog\.principles-gate\s*\{[^}]*inset:\s*0;/);
  assert.match(css, /dialog\.principles-gate\s*\{[^}]*margin:\s*auto;/);

  const window = installWindow();
  let ackStatus = 500;
  const calls: string[] = [];
  const fetchMock = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(`${init?.method ?? "GET"} ${url}`);
    if (url.endsWith("/acknowledge")) {
      if (ackStatus !== 200) return new window.Response(JSON.stringify({ error: "저장하지 못했습니다." }), { status: ackStatus });
      return new window.Response(JSON.stringify({
        notice_version: principles.notice_version,
        acknowledged_at: "2026-11-12T09:20:00.000Z",
      }), { status: 200 });
    }
    return new window.Response(JSON.stringify({ announcements: [principles] }), { status: 200 });
  };
  const previous = globalThis.fetch;
  window.fetch = fetchMock;
  globalThis.fetch = fetchMock;
  const [{ createElement, act }, { createRoot }, { PrinciplesGate }] = await Promise.all([
    import("react"),
    import("react-dom/client"),
    import("./PrinciplesGate.tsx"),
  ]);
  const rootEl = window.document.createElement("div");
  window.document.body.appendChild(rootEl);
  const root = createRoot(rootEl);
  try {
    await act(async () => {
      root.render(createElement(PrinciplesGate));
      await Promise.resolve();
    });
    const dialog = window.document.querySelector("[data-testid='dialog-principles']") as HTMLDialogElement;
    assert.ok(dialog?.open);
    assert.equal(dialog.querySelector("h2")?.textContent, principles.title);
    assert.equal(dialog.querySelectorAll("button").length, 1);
    const button = dialog.querySelector("[data-testid='button-ack-principles']");
    assert.equal(button?.textContent, "읽고 확인했습니다");
    assert.equal(window.document.activeElement, button);
    const style = window.getComputedStyle(dialog);
    assert.equal(style.position, "fixed");
    assert.equal(style.marginTop, "auto");
    assert.equal(style.marginLeft, "auto");

    await act(async () => {
      dialog.dispatchEvent(new window.Event("cancel", { bubbles: true, cancelable: true }));
      dialog.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      dialog.dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true }));
    });
    assert.equal(dialog.open, true);
    assert.equal(calls.some((call) => call.startsWith("POST")), false);

    await act(async () => {
      (button as HTMLButtonElement).click();
      await Promise.resolve();
    });
    assert.equal(dialog.open, true);
    assert.match(dialog.textContent ?? "", /저장하지 못했습니다/);

    ackStatus = 200;
    await act(async () => {
      (button as HTMLButtonElement).click();
      await Promise.resolve();
    });
    assert.equal(window.document.querySelector("[data-testid='dialog-principles']"), null);
    assert.ok(calls.some((call) => call === "POST /api/messages/principles/acknowledge"));
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = previous;
    window.close();
  }
});

test("an already acknowledged owner and a member do not get the dialog", { concurrency: false }, async () => {
  const window = installWindow();
  const payloads = [
    { announcements: [{ ...principles, acknowledged_at: "2026-11-12T09:20:00.000Z" }] },
    { announcements: [] },
  ];
  const fetchMock = async () => new window.Response(JSON.stringify(payloads.shift() ?? { announcements: [] }), { status: 200 });
  const previous = globalThis.fetch;
  window.fetch = fetchMock;
  globalThis.fetch = fetchMock;
  const [{ createElement, act }, { createRoot }, { PrinciplesGate }] = await Promise.all([
    import("react"),
    import("react-dom/client"),
    import("./PrinciplesGate.tsx"),
  ]);
  const rootEl = window.document.createElement("div");
  window.document.body.appendChild(rootEl);
  const root = createRoot(rootEl);
  try {
    for (const _payload of [0, 1]) {
      await act(async () => {
        root.render(createElement(PrinciplesGate));
        await Promise.resolve();
      });
      assert.equal(window.document.querySelector("[data-testid='dialog-principles']"), null);
      await act(async () => root.render(null));
    }
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = previous;
    window.close();
  }
});

test("the messages page pins principles and points 1:1 chat to the matches screen", { concurrency: false }, async () => {
  const window = installWindow();
  const fetchMock = async () => new window.Response(JSON.stringify({
    announcements: [
      principles,
      {
        kind: "owner_notice",
        title: "시설 점검",
        body: "이번 주 시설 점검이 있습니다.",
        published_at: "2026-11-12T10:00:00.000Z",
        notice_version: "owner-notice-fixture",
        is_current: false,
        acknowledged_at: null,
      },
    ],
  }), { status: 200 });
  const previous = globalThis.fetch;
  window.fetch = fetchMock;
  globalThis.fetch = fetchMock;
  const [{ createElement, act }, { createRoot }, { MessagesPage }, { HomeNav }, { Router }] = await Promise.all([
    import("react"),
    import("react-dom/client"),
    import("./MessagesPage.tsx"),
    import("../explore/HomeNav.tsx"),
    import("wouter"),
  ]);
  const rootEl = window.document.createElement("div");
  window.document.body.appendChild(rootEl);
  const root = createRoot(rootEl);
  try {
    await act(async () => {
      root.render(createElement(MessagesPage));
      await Promise.resolve();
    });
    const page = window.document.querySelector("[data-testid='page-messages']");
    assert.ok(page);
    const pinned = window.document.querySelector("[data-testid='notice-principles']");
    const other = window.document.querySelector("[data-testid='notice-owner-notice-fixture']");
    assert.ok(pinned);
    assert.ok(other);
    assert.equal(page?.querySelector("h2")?.textContent, "공지사항");
    assert.equal(pinned?.compareDocumentPosition(other!) & window.Node.DOCUMENT_POSITION_FOLLOWING, window.Node.DOCUMENT_POSITION_FOLLOWING);
    assert.equal(window.document.querySelector("[data-testid='text-principles-ack']")?.textContent, "아직 확인하지 않았습니다.");
    assert.equal(window.document.querySelector("[data-testid='text-direct-placeholder']")?.textContent, "1:1 대화는 서로 매치된 상대와만 할 수 있어요. 매치 화면에서 대화를 열어 주세요.");
    assert.equal(window.document.querySelector("[data-testid='link-direct-matches']")?.getAttribute("href"), "/matches");
    assert.equal(page?.querySelector("input, textarea"), null);

    await act(async () => {
      root.render(createElement(Router, null, createElement(HomeNav, { onBrowse: () => undefined })));
    });
    const messages = window.document.querySelector("[data-testid='nav-messages']");
    assert.equal(messages?.tagName, "A");
    assert.equal(messages?.getAttribute("href"), "/messages");
    assert.equal(window.document.querySelector("[data-testid='text-messages-notice']"), null);
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = previous;
    window.close();
  }
});
