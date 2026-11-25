import test from "node:test";
import assert from "node:assert/strict";
import {
  createDemoMoneyState, setWorkoutComplete, getEligiblePeople, getMatches,
  getUnreadInterest, getRevealQuote, topUpDemo, spendDemo, likeDemo,
} from "./demo-money.ts";

const complete = () => setWorkoutComplete(createDemoMoneyState(), true);
test("before workout, no profiles, interests, match or paid action can be exposed", () => {
  const state = createDemoMoneyState();
  assert.deepEqual(getEligiblePeople(state), []);
  assert.deepEqual(getUnreadInterest(state), []);
  assert.deepEqual(getMatches(state), []);
  for (const kind of ["super", "reveal"] as const) assert.equal(spendDemo(state, kind, ["p1"]).error, "not-completed");
  assert.equal(likeDemo(state, "p1").error, "not-completed");
  assert.equal(state.balance, 0);
});
test("only same-class nonexcluded fictional profiles; mutual match excluded from 3 unread", () => {
  const state = complete();
  assert.deepEqual(getEligiblePeople(state).map(p => p.id), ["p1", "p2", "p3", "p4"]);
  assert.deepEqual(getUnreadInterest(state).map(p => p.id), ["p1", "p2", "p3"]);
  assert.deepEqual(getMatches(state).map(p => p.id), ["p4"]);
  assert.equal(getRevealQuote(state).cost, 6000);
  for (const id of ["other-class", "blocked", "deleted", "withdrawn", "missing"]) {
    assert.equal(spendDemo(state, "reveal", [id]).error, "not-eligible");
    assert.equal(spendDemo(state, "super", [id]).error, "not-eligible");
    assert.equal(likeDemo(state, id).error, "not-eligible");
  }
});
test("one reveal 2000 then remaining two 4000; reread/mutual/duplicate ids never charge twice", () => {
  let state = topUpDemo(complete(), 10000).state;
  state = spendDemo(state, "reveal", ["p1", "p1"]).state;
  assert.equal(state.balance, 8000);
  assert.equal(getRevealQuote(state).cost, 4000);
  assert.equal(spendDemo(state, "reveal", ["p1"]).state, state);
  assert.equal(spendDemo(state, "reveal", ["p4"]).state, state);
  state = spendDemo(state, "reveal", getRevealQuote(state).ids).state;
  assert.equal(state.balance, 4000);
  assert.deepEqual(state.revealed, ["p1", "p2", "p3"]);
  assert.equal(getRevealQuote(state).cost, 0);
  assert.equal(spendDemo(state, "reveal", ["p1", "p2", "p3"]).state, state);
});
test("whole reveal costs 6000 once and failed balances/invalid charges do not mutate anything", () => {
  let state = complete();
  for (const amount of [-2000, 0, 2000, 3000.1, NaN, Infinity]) assert.equal(topUpDemo(state, amount).state, state);
  const failed = spendDemo(state, "reveal", ["p1", "p2", "p3"]);
  assert.equal(failed.error, "insufficient");
  assert.equal(failed.state, state);
  assert.deepEqual(state.history, []);
  state = topUpDemo(state, 10000).state;
  const result = spendDemo(state, "reveal", ["p1", "p2", "p3"]);
  assert.equal(result.state.balance, 4000);
  assert.equal(state.balance, 10000);
  assert.deepEqual(state.revealed, []);
});
test("Super Like 2000 does not like, match or start chat; duplicate and insufficient debit rejected", () => {
  const state = topUpDemo(complete(), 3000).state;
  const result = spendDemo(state, "super", ["p1"]);
  assert.equal(result.state.balance, 1000);
  assert.deepEqual(result.state.superLiked, ["p1"]);
  assert.deepEqual(result.state.liked, ["p4"]);
  assert.deepEqual(getMatches(result.state).map(p => p.id), ["p4"]);
  assert.equal(spendDemo(result.state, "super", ["p1"]).error, "already-super");
  assert.equal(spendDemo(result.state, "super", ["p2"]).error, "insufficient");
  assert.equal(spendDemo(state, "super", ["p1", "p2"]).error, "invalid");
});
test("Like is free, mutual Match is free, already matched cannot be a paid reveal target", () => {
  let state = topUpDemo(complete(), 3000).state;
  state = spendDemo(state, "reveal", ["p1"]).state;
  const result = likeDemo(state, "p1");
  assert.equal(result.state.balance, state.balance);
  assert.deepEqual(getMatches(result.state).map(p => p.id), ["p1", "p4"]);
  assert.equal(getRevealQuote(result.state, ["p1"]).cost, 0);
  assert.equal(likeDemo(result.state, "p1").state, result.state);
  assert.deepEqual(getEligiblePeople(setWorkoutComplete(result.state, false)), []);
});
