import assert from "node:assert/strict";
import test from "node:test";
import type { ClassDetail } from "@workspace/api-client-react";
import { apiSport, buildHomeUrl, filterClasses, HOME_CATEGORIES, parseHome, safeHomeReturn, uiSport } from "./home-filters.ts";

test("all requested categories exist without changing the strength API value", () => {
  assert.deepEqual(HOME_CATEGORIES, ["전체", "러닝", "복싱", "헬스", "요가", "클라이밍", "테니스", "자전거", "수영", "서핑"]);
  assert.equal(apiSport("전체"), undefined);
  assert.equal(apiSport("헬스"), "근력 운동");
  assert.equal(uiSport("근력 운동"), "헬스");
  assert.equal(uiSport("unknown"), "전체");
  assert.equal(uiSport(null), "전체");
});

test("home state survives URL building and parsing including Korean spaces", () => {
  const state = { sport: "복싱", q: "복싱 첫걸음 ", view: "map" as const, open: true, free: false };
  const href = buildHomeUrl(state);
  assert.deepEqual(parseHome(href.slice(href.indexOf("?"))), state);
  assert.equal(safeHomeReturn(href), href);
  assert.equal(buildHomeUrl({ sport: "전체", q: "", view: "list", open: false, free: false }), "/home");
});

test("search text is capped and an encoded 60-character Korean return URL is retained", () => {
  const state = parseHome(`?q=${"한".repeat(65)}&view=map&sport=근력%20운동&open=1&free=1`);
  assert.equal(state.q.length, 60);
  assert.equal(state.sport, "헬스");
  assert.equal(state.open, true);
  assert.equal(state.free, true);
  const href = buildHomeUrl(state);
  assert.ok(href.length > 300);
  assert.equal(safeHomeReturn(href), href);
});

test("external, protocol-relative and unrelated return paths are rejected", () => {
  for (const href of ["https://example.com", "//example.com", "/home/../admin", "/admin", "/home#section", "/home\n", "/home?x=<script>", "/home?" + "x".repeat(1100), "javascript:alert(1)"]) {
    assert.equal(safeHomeReturn(href), null, href);
  }
  assert.equal(safeHomeReturn(undefined), null);
  assert.equal(safeHomeReturn("/home"), "/home");
});

test("raw nested detail queries restore an encoded Korean home URL without double decoding", () => {
  const state = { sport: "복싱", q: "50%20 운동", view: "list" as const, open: true, free: false };
  const back = buildHomeUrl(state);
  const rawDetailSearch = `?back=${encodeURIComponent(back)}`;
  const target = new URLSearchParams(rawDetailSearch).get("back");
  assert.equal(safeHomeReturn(target), back);
  assert.deepEqual(parseHome(new URL(back, "https://example.invalid").search), state);
  const prematurelyDecoded = new URLSearchParams(decodeURI(rawDetailSearch)).get("back");
  assert.equal(safeHomeReturn(prematurelyDecoded), null);
});

const item = (title: string, venue: string, price: number, remaining: number, status = "published") =>
  ({ title, gym: { name: venue }, price, remaining_slots: remaining, status }) as ClassDetail;
const classes = [
  item("샘플 선셋 러닝", "해변 광장", 0, 5),
  item("복싱 첫걸음", "예시 복싱짐", 25000, 2),
  item("샌드백 서킷", "예시 복싱짐 B", 30000, 0),
  item("요가", "예시 요가 룸", 0, 4, "cancelled"),
];

test("search matches class or venue names and supports compound text", () => {
  assert.equal(filterClasses(classes, { q: "샘플 선셋", open: false, free: false }).length, 1);
  assert.equal(filterClasses(classes, { q: "복싱짐", open: false, free: false }).length, 2);
  assert.equal(filterClasses(classes, { q: "없는 이름", open: false, free: false }).length, 0);
});

test("open and free filters use the same loaded classes without inventing data", () => {
  assert.equal(filterClasses(classes, { q: "", open: false, free: false }).length, 4);
  assert.equal(filterClasses(classes, { q: "", open: true, free: false }).length, 2);
  assert.equal(filterClasses(classes, { q: "", open: false, free: true }).length, 2);
  assert.equal(filterClasses(classes, { q: "", open: true, free: true }).length, 1);
});
