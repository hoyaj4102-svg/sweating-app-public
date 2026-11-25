import test from "node:test";
import assert from "node:assert/strict";
import { completeDemoWorkout, createDemoJourney, joinDemoJourney, selectDemoJourney, sendDemoChat, startDemoWorkout } from "./demo-journey.ts";
import { getEligiblePeople, getMatches, getUnreadInterest, likeDemo, spendDemo, topUpDemo } from "./demo-money.ts";
import { safeDemoReturn } from "./demo-enrollment.ts";

function completed() {
  let j = selectDemoJourney(createDemoJourney(), "demo-sunset-run", null);
  j = joinDemoJourney(j);
  return completeDemoWorkout(startDemoWorkout(j), true);
}
test("selection is not confirmation; enrollment and start are required before workout completion", () => {
  const empty = createDemoJourney();
  assert.equal(startDemoWorkout(empty), empty);
  assert.equal(completeDemoWorkout(empty, true), empty);
  const selected = selectDemoJourney(empty, "demo-sunset-run", null);
  assert.equal(selected.enrollment?.joined, false);
  assert.equal(completeDemoWorkout(selected, true), selected);
  const joined = joinDemoJourney(selected);
  assert.equal(joinDemoJourney(joined), joined);
  assert.equal(completeDemoWorkout(joined, true), joined);
  const done = completeDemoWorkout(startDemoWorkout(joined), true);
  assert.equal(done.money.completed, true);
  assert.equal(getEligiblePeople(done.money).length, 4);
  assert.ok(getEligiblePeople(done.money).every(p => p.classId === selected.enrollment?.classId));
});
test("free Like creates reciprocal match and mock chat has no charge or unmatched access", () => {
  let j = completed();
  assert.deepEqual(getMatches(j.money), []);
  assert.equal(sendDemoChat(j, "p1", "안녕하세요"), j);
  j = { ...j, money: likeDemo(j.money, "p1").state };
  assert.deepEqual(getMatches(j.money).map(p => p.id), ["p1"]);
  assert.equal(j.money.balance, 0);
  const sent = sendDemoChat(j, "p1", "  안녕하세요  ");
  assert.equal(sent.messages.p1[0].text, "안녕하세요");
  assert.equal(sent.messages.p1[1].author, "demo");
  assert.equal(sent.money, j.money);
  assert.equal(sendDemoChat(sent, "p2", "Hello"), sent);
  assert.equal(sendDemoChat(sent, "p1", "   "), sent);
  assert.equal(sendDemoChat(sent, "p1", "a".repeat(501)), sent);
  assert.equal(sendDemoChat(sent, "__proto__", "Hello"), sent);
});
test("virtual topup, superlike and single reveal cost exactly 2000 each; repeats are idempotent", () => {
  let j = completed();
  j = { ...j, money: likeDemo(j.money, "p1").state };
  j = { ...j, money: topUpDemo(j.money, 10000).state };
  j = { ...j, money: spendDemo(j.money, "super", ["p2"]).state };
  assert.equal(j.money.balance, 8000);
  assert.deepEqual(getMatches(j.money).map(p => p.id), ["p1"]);
  const duplicate = spendDemo(j.money, "super", ["p2"]);
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.state, j.money);
  j = { ...j, money: spendDemo(j.money, "reveal", ["p2"]).state };
  assert.equal(j.money.balance, 6000);
  assert.equal(spendDemo(j.money, "reveal", ["p2"]).state, j.money);
  assert.equal(spendDemo(j.money, "reveal", ["p1"]).state, j.money);
  assert.equal(getUnreadInterest(j.money).length, 2);
});
test("same-class back navigation preserves journey; other class, reset and reload isolate all state", () => {
  let j = completed();
  j = { ...j, money: topUpDemo(likeDemo(j.money, "p1").state, 5000).state };
  j = sendDemoChat(j, "p1", "가상 메시지");
  assert.equal(selectDemoJourney(j, "demo-sunset-run", null), j);
  const other = selectDemoJourney(j, "demo-yoga-flow", null);
  assert.equal(other.money.classId, "demo-yoga-flow");
  assert.equal(other.money.balance, 0);
  assert.equal(other.money.completed, false);
  assert.equal(other.workoutStarted, false);
  assert.equal(other.enrollment?.joined, false);
  assert.deepEqual(other.messages, {});
  assert.deepEqual(other.money.liked, []);
  const reset = createDemoJourney();
  assert.equal(reset.enrollment, null);
  assert.equal(reset.money.balance, 0);
  assert.deepEqual(reset.messages, {});
});
test("mock messages are bounded and workout reversal blocks chat", () => {
  let j = completed();
  j = { ...j, money: likeDemo(j.money, "p1").state };
  for (let i = 0; i < 30; i++) j = sendDemoChat(j, "p1", `메시지 ${i}`);
  assert.equal(j.messages.p1.length, 40);
  const before = completeDemoWorkout(j, false);
  assert.equal(sendDemoChat(before, "p1", "Hello"), before);
});
test("demo detail returns are narrow and never accept account, external or extra-query targets", () => {
  assert.equal(safeDemoReturn("/preview/detail?class=demo-sunset-run"), "/preview/detail?class=demo-sunset-run");
  for (const value of ["/login", "/profile", "//evil.test", "https://evil.test", "/preview/detail?class=real-id", "/preview/detail?class=demo-sunset-run&next=https://evil.test"]) {
    assert.equal(safeDemoReturn(value), null);
  }
});
