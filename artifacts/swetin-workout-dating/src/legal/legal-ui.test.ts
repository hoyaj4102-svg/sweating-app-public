import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { createElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { Router } from "wouter";
import { ConsentFields } from "./ConsentFields.tsx";
import { PrivacyPage } from "./LegalPages.tsx";
import { SiteFooter } from "../shell/site-footer.tsx";
import { EMPTY_CONSENT } from "./consent.ts";

function installWindow() {
  const window = new Window({
    url: "http://localhost/signup",
    settings: { disableJavaScriptEvaluation: true, disableCSSFileLoading: true },
  });
  const globals = globalThis as typeof globalThis & Record<string, unknown>;
  const assign = (key: string, value: unknown) => {
    try {
      globals[key] = value;
    } catch {
      // Node owns a few globals, such as navigator.
    }
  };
  assign("window", window);
  assign("document", window.document);
  assign("HTMLElement", window.HTMLElement);
  assign("Element", window.Element);
  assign("Node", window.Node);
  assign("DocumentFragment", window.DocumentFragment);
  assign("location", window.location);
  assign("history", window.history);
  assign("navigator", window.navigator);
  assign("addEventListener", window.addEventListener.bind(window));
  assign("removeEventListener", window.removeEventListener.bind(window));
  assign("IS_REACT_ACT_ENVIRONMENT", true);
  return window;
}

test("signup consent, footer, and privacy page expose the draft and the links", async () => {
  installWindow();
  const rootElement = document.createElement("div");
  document.body.appendChild(rootElement);
  const root = createRoot(rootElement);
  await act(async () => {
    root.render(createElement(Router, null,
      createElement("div", null,
        createElement(ConsentFields, { value: EMPTY_CONSENT, onChange: () => undefined }),
        createElement(SiteFooter),
        createElement(PrivacyPage, { header: null }),
      ),
    ));
  });
  const text = document.body.textContent ?? "";
  assert.match(text, /법률 검토 전 초안/);
  assert.match(text, /\[사업자 상호\]/);
  assert.match(text, /국외 이전/);
  assert.equal(document.querySelectorAll("[data-testid='consent-terms']").length, 1);
  assert.equal(document.querySelectorAll("[data-testid='consent-privacy']").length, 1);
  assert.equal(document.querySelectorAll("[data-testid='consent-overseas']").length, 1);
  const hrefs = [...document.querySelectorAll("a")].map((anchor) => anchor.getAttribute("href"));
  assert.equal(hrefs.includes("/terms"), true);
  assert.equal(hrefs.includes("/privacy"), true);
  assert.equal(hrefs.includes("/privacy#overseas"), true);
  await act(async () => root.unmount());
});
