import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Window } from "happy-dom";
import type { HeaderSession } from "./site-header.tsx";

const css = [
  new URL("../index.css", import.meta.url),
  new URL("../campaign-marketing.css", import.meta.url),
].map((url) => readFileSync(url, "utf8").replace(/^@import[^;]*;/gm, "")).join("\n");

const member: HeaderSession = { profile: { display_name: "나영", is_admin: false } };

type Ui = {
  createElement: typeof import("react").createElement;
  act: typeof import("react").act;
  createRoot: typeof import("react-dom/client").createRoot;
  Router: typeof import("wouter").Router;
  SiteHeader: typeof import("./site-header.tsx").SiteHeader;
};

let uiPromise: Promise<Ui> | null = null;

function installWindow(width: number) {
  const window = new Window({
    url: "http://localhost/",
    width,
    height: 900,
    settings: { disableJavaScriptEvaluation: true, disableCSSFileLoading: true },
  });
  const globals = globalThis as typeof globalThis & Record<string, unknown>;
  const assign = (key: string, value: unknown) => {
    try {
      globals[key] = value;
    } catch {
      // Node owns a few globals, such as navigator. The happy-dom window still exposes them.
    }
  };
  assign("window", window);
  assign("document", window.document);
  assign("HTMLElement", window.HTMLElement);
  assign("Element", window.Element);
  assign("Node", window.Node);
  assign("DocumentFragment", window.DocumentFragment);
  assign("SVGElement", window.SVGElement);
  assign("Text", window.Text);
  assign("Comment", window.Comment);
  assign("MutationObserver", window.MutationObserver);
  assign("KeyboardEvent", window.KeyboardEvent);
  assign("MouseEvent", window.MouseEvent);
  assign("PointerEvent", window.PointerEvent);
  assign("Event", window.Event);
  assign("getComputedStyle", window.getComputedStyle.bind(window));
  assign("requestAnimationFrame", window.requestAnimationFrame.bind(window));
  assign("cancelAnimationFrame", window.cancelAnimationFrame.bind(window));
  assign("location", window.location);
  assign("history", window.history);
  assign("addEventListener", window.addEventListener.bind(window));
  assign("removeEventListener", window.removeEventListener.bind(window));
  assign("IS_REACT_ACT_ENVIRONMENT", true);
  const style = window.document.createElement("style");
  style.textContent = css;
  window.document.head.appendChild(style);
  return window;
}

async function loadUi() {
  if (!globalThis.document) installWindow(1280);
  uiPromise ??= Promise.all([
    import("react"),
    import("react-dom/client"),
    import("wouter"),
    import("./site-header.tsx"),
  ]).then(([react, reactDom, wouter, header]) => ({
    createElement: react.createElement,
    act: react.act,
    createRoot: reactDom.createRoot,
    Router: wouter.Router,
    SiteHeader: header.SiteHeader,
  }));
  return uiPromise;
}

function isShown(element: Element | null) {
  assert.ok(element);
  let current: Element | null = element;
  while (current) {
    const display = current.ownerDocument.defaultView?.getComputedStyle(current).display;
    assert.notEqual(display, "none", current.className || current.tagName);
    current = current.parentElement;
  }
}

async function renderHeader(width: number, session: HeaderSession, signOut: () => void) {
  const window = installWindow(width);
  const ui = await loadUi();
  const rootEl = window.document.createElement("div");
  window.document.body.appendChild(rootEl);
  const root = ui.createRoot(rootEl);
  await ui.act(async () => {
    root.render(ui.createElement(ui.Router, null, ui.createElement(ui.SiteHeader, { session, signOut })));
  });
  return {
    window,
    act: ui.act,
    async click(element: Element) {
      await ui.act(async () => {
        (element as HTMLButtonElement).click();
      });
    },
    async cleanup() {
      await ui.act(async () => {
        root.unmount();
      });
      window.close();
    },
  };
}

test("desktop width shows a logout control for a logged-in user", { concurrency: false }, async () => {
  let calls = 0;
  const view = await renderHeader(1280, member, () => { calls += 1; });
  try {
    const account = view.window.document.querySelector("[data-testid='button-header-account']");
    isShown(account);
    assert.equal(account?.textContent, "나");
    assert.equal(account?.getAttribute("aria-label"), "계정 메뉴");
    assert.equal(account?.getAttribute("aria-haspopup"), "menu");
    assert.equal(account?.tagName, "BUTTON");
    const trigger = view.window.document.querySelector(".menu-trigger");
    assert.equal(trigger?.ownerDocument.defaultView?.getComputedStyle(trigger).display, "none");
    assert.equal(view.window.document.querySelector(".mobile-drawer"), null);
    assert.equal(view.window.document.querySelector("[data-testid='button-header-logout']"), null);
    assert.equal(view.window.document.querySelector("[data-testid='link-header-start']"), null);

    await view.click(account!);
    const panel = view.window.document.querySelector(".account-menu-panel");
    const logout = view.window.document.querySelector("[data-testid='button-header-logout']");
    isShown(logout);
    assert.match(logout?.textContent ?? "", /로그아웃/);
    assert.equal(logout?.closest(".mobile-drawer"), null);
    assert.equal(logout?.closest(".account-menu-panel"), panel);
    assert.match(panel?.textContent ?? "", /프로필 설정/);
    assert.match(panel?.textContent ?? "", /클래스 둘러보기/);
    assert.equal(account?.getAttribute("aria-expanded"), "true");

    await view.act(async () => {
      view.window.document.dispatchEvent(new view.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    assert.equal(view.window.document.querySelector(".account-menu-panel"), null);
    assert.equal(account?.getAttribute("aria-expanded"), "false");
    assert.equal(calls, 0);
  } finally {
    await view.cleanup();
  }
});

test("clicking the desktop logout control calls the existing logout handler", { concurrency: false }, async () => {
  const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  const header = readFileSync(new URL("./site-header.tsx", import.meta.url), "utf8");
  assert.match(app, /<SiteHeader session=\{session\} signOut=\{signOut\} showClassDemo=\{isClassDemoMode\} showUxDemo=\{isUxDemoMode\} \/>/);
  assert.match(app, /const signOut = async \(\) => \{\n {4}try \{ await logOut\(\); \} finally \{ setSession\(null\); window\.location\.href = "\/"; \}\n {2}\};/);
  assert.equal(header.includes("logOut"), false);
  assert.equal(header.match(/void signOut\(\)/g)?.length, 2);

  let calls = 0;
  const view = await renderHeader(1100, member, () => { calls += 1; });
  try {
    const account = view.window.document.querySelector("[data-testid='button-header-account']");
    assert.ok(account);
    await view.click(account);
    const logout = view.window.document.querySelector("[data-testid='button-header-logout']");
    assert.ok(logout);
    isShown(logout);
    await view.click(logout);
    assert.equal(calls, 1);
  } finally {
    await view.cleanup();
  }
});

test("mobile menu still contains logout", { concurrency: false }, async () => {
  let calls = 0;
  const view = await renderHeader(390, member, () => { calls += 1; });
  try {
    const account = view.window.document.querySelector(".account-menu");
    assert.equal(account?.ownerDocument.defaultView?.getComputedStyle(account).display, "none");
    const trigger = view.window.document.querySelector(".menu-trigger");
    isShown(trigger);
    await view.click(trigger!);
    const drawer = view.window.document.querySelector(".mobile-drawer");
    assert.ok(drawer);
    const logout = drawer.querySelector(".drawer-signout");
    isShown(logout);
    assert.match(logout?.textContent ?? "", /로그아웃/);
    assert.match(drawer.textContent ?? "", /프로필 설정/);
    assert.match(drawer.textContent ?? "", /클래스 둘러보기/);
    assert.match(drawer.textContent ?? "", /내 활동/);
    assert.match(drawer.textContent ?? "", /매치/);
    await view.click(logout!);
    assert.equal(calls, 1);
    assert.equal(view.window.document.querySelector("[data-testid='button-header-logout']"), null);
  } finally {
    await view.cleanup();
  }
});

test("signed-out header does not show logout", { concurrency: false }, async () => {
  for (const width of [1280, 390]) {
    const view = await renderHeader(width, null, () => { throw new Error("signed-out logout should not run"); });
    try {
      assert.equal(view.window.document.querySelector("[data-testid='button-header-logout']"), null);
      assert.equal(view.window.document.querySelector(".drawer-signout"), null);
      if (width < 700) {
        const trigger = view.window.document.querySelector(".menu-trigger");
        isShown(trigger);
        await view.click(trigger!);
        const drawer = view.window.document.querySelector(".mobile-drawer");
        assert.match(drawer?.textContent ?? "", /시작하기/);
        assert.doesNotMatch(drawer?.textContent ?? "", /로그인/);
        assert.doesNotMatch(drawer?.textContent ?? "", /로그아웃/);
      }
    } finally {
      await view.cleanup();
    }
  }
});

test("a logged-in header links to messages and a signed-out header does not", { concurrency: false }, async () => {
  const desktop = await renderHeader(1280, member, () => undefined);
  try {
    const link = desktop.window.document.querySelector("[data-testid='link-header-messages']");
    isShown(link);
    assert.equal(link?.tagName, "A");
    assert.equal(link?.getAttribute("href"), "/messages");
    assert.equal(link?.textContent, "메시지");
    const account = desktop.window.document.querySelector("[data-testid='button-header-account']");
    await desktop.click(account!);
    const menuItem = desktop.window.document.querySelector("[data-testid='button-account-messages']");
    isShown(menuItem);
    assert.equal(menuItem?.textContent, "메시지");
    await desktop.click(menuItem!);
    assert.equal(desktop.window.location.pathname, "/messages");
  } finally {
    await desktop.cleanup();
  }

  const mobile = await renderHeader(390, member, () => undefined);
  try {
    assert.equal(mobile.window.document.querySelector("[data-testid='link-header-messages']")?.ownerDocument.defaultView?.getComputedStyle(mobile.window.document.querySelector(".desktop-nav")!).display, "none");
    const trigger = mobile.window.document.querySelector(".menu-trigger");
    await mobile.click(trigger!);
    const drawerLink = mobile.window.document.querySelector("[data-testid='button-drawer-messages']");
    isShown(drawerLink);
    assert.equal(drawerLink?.textContent, "메시지");
    await mobile.click(drawerLink!);
    assert.equal(mobile.window.location.pathname, "/messages");
  } finally {
    await mobile.cleanup();
  }

  const signedOut = await renderHeader(1280, null, () => undefined);
  try {
    assert.equal(signedOut.window.document.querySelector("[data-testid='link-header-messages']"), null);
    assert.equal(signedOut.window.document.querySelector("[data-testid='button-account-messages']"), null);
    const trigger = signedOut.window.document.querySelector(".menu-trigger");
    if (trigger && signedOut.window.getComputedStyle(trigger).display !== "none") {
      await signedOut.click(trigger);
    }
    assert.equal(signedOut.window.document.querySelector("[data-testid='button-drawer-messages']"), null);
  } finally {
    await signedOut.cleanup();
  }
});

test("signed-out header uses one start control for the member choice", { concurrency: false }, async () => {
  for (const width of [1280, 390]) {
    const view = await renderHeader(width, null, () => { throw new Error("signed-out logout should not run"); });
    try {
      const start = view.window.document.querySelector("[data-testid='link-header-start']");
      isShown(start);
      assert.equal(start?.textContent, "시작하기");
      assert.equal(start?.getAttribute("href"), "/start");
      assert.equal(start?.tagName, "A");
      const nav = view.window.document.querySelector(".desktop-nav");
      assert.match(nav?.textContent ?? "", /소개/);
      assert.match(nav?.textContent ?? "", /클래스/);
      assert.match(nav?.textContent ?? "", /체육관 파트너/);
      assert.equal([...nav!.querySelectorAll("a")].filter((link) => link.textContent === "시작하기").length, 0);
      assert.doesNotMatch(view.window.document.querySelector(".site-header")?.textContent ?? "", /로그인/);

      if (width < 700) {
        const trigger = view.window.document.querySelector(".menu-trigger");
        isShown(trigger);
        await view.click(trigger!);
        const drawer = view.window.document.querySelector(".mobile-drawer");
        assert.ok(drawer);
        const drawerStarts = [...drawer.querySelectorAll("button")].filter((button) => button.textContent === "시작하기");
        assert.equal(drawerStarts.length, 1);
        assert.equal(drawerStarts[0]?.getAttribute("data-testid"), "button-drawer-start");
        assert.match(drawer.textContent ?? "", /SWEATING 소개/);
        assert.match(drawer.textContent ?? "", /클래스 둘러보기/);
        assert.match(drawer.textContent ?? "", /체육관 파트너/);
        assert.doesNotMatch(drawer.textContent ?? "", /로그인/);
        await view.click(drawerStarts[0]!);
        assert.equal(view.window.location.pathname, "/start");
      } else {
        assert.equal(view.window.document.querySelector(".menu-trigger")?.ownerDocument.defaultView?.getComputedStyle(view.window.document.querySelector(".menu-trigger")!).display, "none");
        await view.click(start!);
        assert.equal(view.window.location.pathname, "/start");
      }
    } finally {
      await view.cleanup();
    }
  }
});
