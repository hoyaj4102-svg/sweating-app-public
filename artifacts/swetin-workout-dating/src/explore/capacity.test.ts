import assert from "node:assert/strict";
import test from "node:test";
import { aggregate, fullMessage, parseCount, SEED_CAPACITY, slotView, splitEven, validateCapacity } from "./capacity.ts";
import { addCreated, getCreated, getCreatedCapacity, subscribeDemo } from "./demo-store.ts";

test("even totals use 50:50; odd totals require an explicit allocation", () => {
  for (const n of [4, 6, 8, 10]) assert.deepEqual(splitEven(n), { male: n / 2, female: n / 2 });
  for (const n of [0, -2, 3, 7, 1.5]) assert.equal(splitEven(n), null);
});

test("counts reject blanks, fractions, negative values and non-numeric input", () => {
  for (const value of ["", " ", "-1", "+2", "1.5", "NaN", "Infinity", "1e2"]) {
    assert.equal(parseCount(value), null);
  }
  assert.equal(parseCount("0"), 0);
  assert.equal(parseCount(" 12 "), 12);
});

test("gender quotas must sum to the total", () => {
  assert.equal(validateCapacity({ total: "8", enabled: true, male: "4", female: "4" }).ok, true);
  const mismatch = validateCapacity({ total: "8", enabled: true, male: "3", female: "4" });
  assert.equal(mismatch.ok, false);
  assert.ok(mismatch.errors.sum);
  assert.equal(mismatch.values, undefined);
});

test("zero or invalid total and invalid gender quotas cannot be saved", () => {
  for (const total of ["0", "-1", "", "3.5"]) {
    assert.equal(validateCapacity({ total, enabled: true, male: "4", female: "4" }).ok, false);
  }
  for (const male of ["", "-1", "4.5"]) {
    assert.equal(validateCapacity({ total: "8", enabled: true, male, female: "4" }).ok, false);
  }
});

test("an explicit odd allocation and a zero-quota gender are supported", () => {
  const odd = validateCapacity({ total: "7", enabled: true, male: "3", female: "4" });
  assert.equal(odd.ok, true);
  assert.ok(odd.info);
  assert.deepEqual(odd.values, { total: 7, male: 3, female: 4 });
  assert.equal(validateCapacity({ total: "4", enabled: true, male: "0", female: "4" }).ok, true);
});

test("nonlimited classes ignore gender fields but still require a valid total", () => {
  const result = validateCapacity({ total: "7", enabled: false, male: "", female: "-1" });
  assert.equal(result.ok, true);
  assert.deepEqual(result.values, { total: 7, male: 0, female: 0 });
  assert.equal(validateCapacity({ total: "0", enabled: false, male: "", female: "" }).ok, false);
});

test("remaining slots and progress reflect open, full and zero-quota states", () => {
  assert.deepEqual(slotView({ capacity: 3, joined: 2 }), {
    capacity: 3, joined: 2, remaining: 1, full: false, pct: 67, label: "모집 중",
  });
  assert.equal(slotView({ capacity: 3, joined: 3 }).full, true);
  assert.equal(slotView({ capacity: 3, joined: 4 }).remaining, 0);
  assert.equal(slotView({ capacity: 3, joined: 4 }).pct, 100);
  const zero = slotView({ capacity: 0, joined: 0 });
  assert.equal(zero.full, true);
  assert.equal(zero.remaining, 0);
  assert.equal(zero.pct, 0);
  assert.equal(Number.isFinite(zero.pct), true);
});

test("gender-specific closed messages use the requested wording", () => {
  assert.equal(fullMessage("male"), "이번 클래스의 남성 참가 정원이 마감되었어요.");
  assert.equal(fullMessage("female"), "이번 클래스의 여성 참가 정원이 마감되었어요.");
});

test("all seeded quota aggregates match the class sample totals", () => {
  const totals: Record<string, [number, number]> = {
    "demo-sunset-run": [12, 7],
    "demo-boxing-basic": [8, 6],
    "demo-boxing-fit": [10, 10],
    "demo-bouldering": [8, 3],
    "demo-tennis-rally": [8, 4],
    "demo-yoga-flow": [14, 9],
    "demo-yoga-park": [16, 5],
    "demo-surf-lesson": [6, 4],
  };
  for (const [id, [total, joined]] of Object.entries(totals)) {
    const cap = SEED_CAPACITY[id];
    assert.ok(cap);
    assert.equal(aggregate(cap, total, joined), true, id);
    if (cap.enabled) {
      assert.equal(slotView(cap.male).joined <= cap.male.capacity, true, id);
      assert.equal(slotView(cap.female).joined <= cap.female.capacity, true, id);
    }
  }
  const run = SEED_CAPACITY["demo-sunset-run"];
  const boxing = SEED_CAPACITY["demo-boxing-basic"];
  assert.ok(run.enabled && boxing.enabled);
  assert.equal(slotView(run.male).full, true);
  assert.equal(slotView(run.female).full, false);
  assert.equal(slotView(boxing.male).full, false);
  assert.equal(slotView(boxing.female).full, true);
  assert.equal(SEED_CAPACITY["demo-bouldering"].enabled, false);
});

test("temporary sample store has stable snapshots and notifies subscribers", () => {
  const initial = getCreated();
  assert.equal(getCreated(), initial);
  let notifications = 0;
  const unsubscribe = subscribeDemo(() => { notifications++; });
  const entry = { item: { id: "demo-test-local" }, extra: {} } as Parameters<typeof addCreated>[0];
  addCreated(entry, { enabled: false });
  assert.notEqual(getCreated(), initial);
  assert.equal(getCreated()[0], entry);
  assert.deepEqual(getCreatedCapacity(entry.item.id), { enabled: false });
  assert.equal(notifications, 1);
  assert.equal(getCreated(), getCreated());
  unsubscribe();
  addCreated({ ...entry, item: { ...entry.item, id: "demo-test-local-2" } }, { enabled: false });
  assert.equal(notifications, 1);
});
