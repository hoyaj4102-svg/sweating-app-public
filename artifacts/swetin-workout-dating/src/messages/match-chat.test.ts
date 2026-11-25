import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Window } from "happy-dom";
import {
  MATCH_MESSAGE_MAX_LENGTH,
  MATCH_REPORT_DETAIL_MAX_LENGTH,
  MATCH_REPORT_OPTIONS,
  appendMessage,
  canSendMessage,
  canSubmitReportDetail,
  messageLength,
  readBlockStatus,
  readMatchMessages,
  readSentMessage,
} from "./match-chat.ts";

const matchId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee5";

function installWindow() {
  const window = new Window({
    url: "http://localhost/",
    width: 390,
    height: 844,
    settings: { disableJavaScriptEvaluation: true, disableCSSFileLoading: true },
  });
  const globals = globalThis as typeof globalThis & Record<string, unknown>;
  for (const key of [
    "window",
    "document",
    "HTMLElement",
    "HTMLTextAreaElement",
    "HTMLSelectElement",
    "HTMLButtonElement",
    "HTMLFormElement",
    "Element",
    "Node",
    "Event",
    "KeyboardEvent",
    "MouseEvent",
    "SubmitEvent",
  ]) {
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
  return window;
}

test("chat helpers keep the 1000/500 character limits and only well-formed rows", () => {
  assert.equal(MATCH_MESSAGE_MAX_LENGTH, 1000);
  assert.equal(MATCH_REPORT_DETAIL_MAX_LENGTH, 500);
  assert.equal(MATCH_REPORT_OPTIONS.length, 5);
  assert.equal(canSendMessage("가".repeat(1000)), true);
  assert.equal(canSendMessage("가".repeat(1001)), false);
  assert.equal(canSendMessage("💪".repeat(1000)), true);
  assert.equal(messageLength("  안녕  "), 2);
  assert.equal(canSendMessage("   "), false);
  assert.equal(canSubmitReportDetail("가".repeat(500)), true);
  assert.equal(canSubmitReportDetail("가".repeat(501)), false);
  const rows = readMatchMessages({ messages: [
    { id: "m1", body: "hi", created_at: "2026-11-24T09:00:00Z", is_mine: true },
    { id: "m2", body: "x", created_at: "2026-11-24T09:00:00Z", sender_id: "someone" },
    "junk",
  ] });
  assert.deepEqual(rows.map((row) => row.id), ["m1"]);
  assert.equal(readMatchMessages(null).length, 0);
  assert.equal(readSentMessage({ message: { id: "m3" } }), null);
  assert.deepEqual(readBlockStatus({ block: { is_blocked: true, blocked_by_me: false } }), {
    is_blocked: true,
    blocked_by_me: false,
  });
  assert.equal(readBlockStatus({ block: { is_blocked: "yes" } }), null);
  const sent = { id: "m3", body: "yo", created_at: "2026-11-24T09:01:00Z", is_mine: true };
  assert.deepEqual(appendMessage(rows, sent).map((row) => row.id), ["m1", "m3"]);
  assert.equal(appendMessage([...rows, sent], sent).length, 2);
});

test("matches link to the chat route and the chat route needs a profile", () => {
  const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  assert.match(app, /<Route path="\/matches\/:id\/chat">\{params => session\?\.profile \?/);
  assert.match(app, /<MatchChatPage matchId=\{params\.id\} \/>/);
  assert.match(app, /href=\{`\/matches\/\$\{encodeURIComponent\(match\.id\)\}\/chat`\}/);
  assert.ok(app.indexOf('path="/matches/:id/chat"') < app.indexOf('path="/matches"'));
  assert.match(app, /<Route path="\/messages">/);
});

test("the chat screen supports sending, rate limit errors, blocking, unblocking, and reporting", { concurrency: false }, async () => {
  const window = installWindow();
  const calls: Array<{ method: string; url: string; body: string }> = [];
  let sendStatus = 201;
  let sendError = "이 매치에서는 대화할 수 없습니다.";
  let blockState = { is_blocked: false, blocked_by_me: false };
  const fetchMock = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ method, url, body: typeof init?.body === "string" ? init.body : "" });
    if (url === `/api/matches/${matchId}`) {
      return new window.Response(JSON.stringify({ id: matchId, class_title: "선셋 러닝", participant: { display_name: "민지" } }), { status: 200 });
    }
    if (url === `/api/matches/${matchId}/messages` && method === "GET") {
      return new window.Response(JSON.stringify({
        messages: [
          { id: "m1", body: "오늘 즐거웠어요", created_at: "2026-11-24T09:00:00Z", is_mine: false },
          { id: "m2", body: "저도요!", created_at: "2026-11-24T09:01:00Z", is_mine: true },
        ],
        block: blockState,
      }), { status: 200 });
    }
    if (url === `/api/matches/${matchId}/messages` && method === "POST") {
      if (sendStatus !== 201) {
        return new window.Response(JSON.stringify({ error: sendError }), { status: sendStatus });
      }
      const sent = JSON.parse(String(init?.body)) as { body: string };
      return new window.Response(JSON.stringify({ message: { id: "m3", body: sent.body, created_at: "2026-11-24T09:02:00Z", is_mine: true } }), { status: 201 });
    }
    if (url === `/api/matches/${matchId}/block` && method === "POST") {
      blockState = { is_blocked: true, blocked_by_me: true };
      return new window.Response(JSON.stringify({ block: blockState }), { status: 200 });
    }
    if (url === `/api/matches/${matchId}/block` && method === "DELETE") {
      blockState = { is_blocked: false, blocked_by_me: false };
      return new window.Response(JSON.stringify({ block: blockState }), { status: 200 });
    }
    if (url === `/api/matches/${matchId}/reports` && method === "POST") {
      return new window.Response(JSON.stringify({ report: { id: "r1", created_at: "2026-11-25T00:00:00Z" } }), { status: 201 });
    }
    return new window.Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
  };
  const previous = globalThis.fetch;
  window.fetch = fetchMock as typeof window.fetch;
  globalThis.fetch = fetchMock as typeof globalThis.fetch;
  const [{ createElement, act }, { createRoot }, { MatchChatPage }] = await Promise.all([
    import("react"),
    import("react-dom/client"),
    import("./MatchChatPage.tsx"),
  ]);
  const rootEl = window.document.createElement("div");
  window.document.body.appendChild(rootEl);
  const root = createRoot(rootEl);
  const flush = async () => {
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
  };
  try {
    await act(async () => {
      root.render(createElement(MatchChatPage, { matchId, pollMs: 0 }));
      await flush();
    });
    const doc = window.document;
    assert.equal(doc.querySelector("[data-testid='text-chat-title']")?.textContent, "민지님과의 대화");
    const bubbles = [...doc.querySelectorAll("[data-testid^='chat-message-']")];
    assert.deepEqual(bubbles.map((node) => node.querySelector("p")?.textContent), ["오늘 즐거웠어요", "저도요!"]);
    assert.equal(bubbles[1].classList.contains("is-mine"), true);
    assert.equal(bubbles[0].classList.contains("is-mine"), false);
    assert.ok(doc.querySelector("[data-testid='button-report-message-m1']"));
    assert.equal(doc.querySelector("[data-testid='button-report-message-m2']"), null);

    const setValue = async (el: HTMLTextAreaElement, value: string) => {
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")?.set;
        setter?.call(el, value);
        el.dispatchEvent(new window.Event("input", { bubbles: true }));
        await flush();
      });
    };

    const button = doc.querySelector("[data-testid='button-chat-send']") as HTMLButtonElement;
    assert.equal(button.disabled, true);
    const input = doc.querySelector("[data-testid='input-chat-message']") as HTMLTextAreaElement;
    await setValue(input, "가".repeat(1001));
    assert.equal(button.disabled, true);
    assert.equal(doc.querySelector("[data-testid='text-chat-count']")?.textContent, "1001/1000");

    await setValue(input, "  다음에 또 운동해요  ");
    assert.equal(button.disabled, false);
    await act(async () => {
      button.click();
      await flush();
    });
    const post = calls.find((call) => call.method === "POST" && call.url.endsWith("/messages"));
    assert.deepEqual(JSON.parse(post?.body ?? "{}"), { body: "다음에 또 운동해요" });
    assert.equal(doc.querySelectorAll("[data-testid^='chat-message-']").length, 3);
    assert.equal(input.value, "");

    // 429 rate limit keeps the form open and displays the Korean error.
    sendStatus = 429;
    sendError = "잠시 후 다시 보내 주세요. 1분에 최대 10개까지 보낼 수 있습니다.";
    await setValue(input, "연속 발송");
    await act(async () => {
      (doc.querySelector("[data-testid='button-chat-send']") as HTMLButtonElement).click();
      await flush();
    });
    assert.equal(doc.querySelector("[data-testid='text-chat-error']")?.textContent, sendError);
    assert.ok(doc.querySelector("[data-testid='form-chat']"));

    // Report a specific message.
    await act(async () => {
      (doc.querySelector("[data-testid='button-report-message-m1']") as HTMLButtonElement).click();
      await flush();
    });
    assert.ok(doc.querySelector("[data-testid='form-chat-report']"));
    const detailInput = doc.querySelector("[data-testid='input-report-detail']") as HTMLTextAreaElement;
    await setValue(detailInput, "  부적절한 메시지입니다  ");
    await act(async () => {
      (doc.querySelector("[data-testid='button-report-submit']") as HTMLButtonElement).click();
      await flush();
    });
    const reportCall = calls.find((call) => call.url.endsWith("/reports"));
    assert.deepEqual(JSON.parse(reportCall?.body ?? "{}"), {
      reason: "harassment",
      detail: "부적절한 메시지입니다",
      message_id: "m1",
    });
    assert.equal(doc.querySelector("[data-testid='form-chat-report']"), null);
    assert.equal(doc.querySelector("[data-testid='text-chat-notice']")?.textContent, "신고가 접수됐어요. 운영팀이 확인합니다.");

    // Block -> confirm -> blocked banner + unblock button -> unblock restores form.
    await act(async () => {
      (doc.querySelector("[data-testid='button-chat-block']") as HTMLButtonElement).click();
      await flush();
    });
    assert.ok(doc.querySelector("[data-testid='confirm-chat-block']"));
    await act(async () => {
      (doc.querySelector("[data-testid='button-chat-block-confirm']") as HTMLButtonElement).click();
      await flush();
    });
    assert.equal(doc.querySelector("[data-testid='form-chat']"), null);
    assert.equal(doc.querySelector("[data-testid='text-chat-blocked']")?.textContent, "상대방을 차단해 새 메시지를 보낼 수 없어요.");
    assert.ok(doc.querySelector("[data-testid='button-chat-unblock']"));

    await act(async () => {
      (doc.querySelector("[data-testid='button-chat-unblock']") as HTMLButtonElement).click();
      await flush();
    });
    assert.ok(doc.querySelector("[data-testid='form-chat']"));
    assert.equal(doc.querySelector("[data-testid='text-chat-blocked']"), null);
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = previous;
    window.close();
  }
});

test("a user blocked by the partner cannot unblock or send, and a non-member sees closed chat", { concurrency: false }, async () => {
  const window = installWindow();
  let mode: "blocked_by_other" | "forbidden" = "blocked_by_other";
  const fetchMock = async (input: RequestInfo | URL) => {
    const url = String(input);
    if (mode === "blocked_by_other") {
      if (url === `/api/matches/${matchId}`) {
        return new window.Response(JSON.stringify({ id: matchId, class_title: "선셋 러닝", participant: { display_name: "민지" } }), { status: 200 });
      }
      return new window.Response(JSON.stringify({
        messages: [],
        block: { is_blocked: true, blocked_by_me: false },
      }), { status: 200 });
    }
    if (url.endsWith("/messages")) {
      return new window.Response(JSON.stringify({ error: "이 매치에서는 대화할 수 없습니다." }), { status: 403 });
    }
    return new window.Response(JSON.stringify({ error: "forbidden" }), { status: 403 });
  };
  const previous = globalThis.fetch;
  window.fetch = fetchMock as typeof window.fetch;
  globalThis.fetch = fetchMock as typeof globalThis.fetch;
  const [{ createElement, act }, { createRoot }, { MatchChatPage }] = await Promise.all([
    import("react"),
    import("react-dom/client"),
    import("./MatchChatPage.tsx"),
  ]);
  const rootEl = window.document.createElement("div");
  window.document.body.appendChild(rootEl);
  const root = createRoot(rootEl);
  try {
    await act(async () => {
      root.render(createElement(MatchChatPage, { matchId, pollMs: 0 }));
      for (let i = 0; i < 6; i += 1) await Promise.resolve();
    });
    assert.equal(window.document.querySelector("[data-testid='text-chat-blocked']")?.textContent, "대화가 차단되어 새 메시지를 보낼 수 없어요.");
    assert.equal(window.document.querySelector("[data-testid='button-chat-unblock']"), null);
    assert.equal(window.document.querySelector("[data-testid='form-chat']"), null);

    mode = "forbidden";
    await act(async () => {
      root.render(createElement(MatchChatPage, { matchId: `${matchId}-x`, pollMs: 0 }));
      for (let i = 0; i < 6; i += 1) await Promise.resolve();
    });
    assert.equal(window.document.querySelector("[data-testid='text-chat-title']")?.textContent, "1:1 대화");
    assert.ok(window.document.querySelector("[data-testid='text-chat-closed']"));
    assert.equal(window.document.querySelector("[data-testid='form-chat']"), null);
    assert.equal(window.document.querySelectorAll("[data-testid^='chat-message-']").length, 0);
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = previous;
    window.close();
  }
});
