import assert from "node:assert/strict";
import test from "node:test";
import { classLoginUrl, classProfileUrl, parseClassReturn, safeClassReturn } from "./auth-return.ts";
import { buildHomeUrl, parseHome, safeHomeReturn } from "./home-filters.ts";

test("only explicit local class routes are valid login destinations", () => {
  assert.equal(safeClassReturn("/classes/demo-boxing-basic"), "/classes/demo-boxing-basic");
  assert.equal(safeClassReturn("/classes/550e8400-e29b-41d4-a716-446655440000"), "/classes/550e8400-e29b-41d4-a716-446655440000");
  for (const url of ["https://example.com", "//example.com/classes/x", "/admin", "/home", "/classes/", "/classes/x/y", "/classes/../admin", "/classes/%2e%2e", "/classes/x\n", "/classes/x#fragment", "javascript:alert(1)"]) {
    assert.equal(safeClassReturn(url), null, url);
  }
  assert.equal(safeClassReturn(null), null);
  assert.equal(safeClassReturn(undefined), null);
  assert.equal(safeClassReturn("/classes/x?" + "q".repeat(2100)), null);
});

test("login/profile retain the same allowlisted class and home state", () => {
  const state = { sport: "복싱", q: "샘플해변 50%20", view: "map" as const, open: true, free: true };
  const home = buildHomeUrl(state);
  const target = `/classes/demo-boxing-basic?back=${encodeURIComponent(home)}`;
  for (const make of [classLoginUrl, classProfileUrl]) {
    const href = make(target);
    const restored = parseClassReturn(href.slice(href.indexOf("?")));
    assert.equal(restored, target);
    const restoredHome = new URLSearchParams(restored!.split("?")[1]).get("back");
    assert.equal(safeHomeReturn(restoredHome), home);
    assert.deepEqual(parseHome(restoredHome!.slice(restoredHome!.indexOf("?"))), state);
  }
});

test("invalid or absent targets do not create a redirect to another site", () => {
  assert.equal(classLoginUrl("//example.com"), "/login");
  assert.equal(classProfileUrl("https://example.com"), "/profile");
  assert.equal(parseClassReturn("?next=https%3A%2F%2Fexample.com"), null);
  assert.equal(parseClassReturn("?next=%2F%2Fexample.com"), null);
  assert.equal(parseClassReturn(""), null);
});
