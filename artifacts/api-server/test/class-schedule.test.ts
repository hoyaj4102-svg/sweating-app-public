import assert from "node:assert/strict";
import test from "node:test";
import {
  CLASS_STARTED_CODE,
  classHasStarted,
  isClassStartedError,
  isUpcomingClass,
  upcomingScheduledAtFilter,
} from "../src/lib/class-schedule.ts";

const START = "2026-11-02T11:00:00.000Z"; // 2026-11-02 20:00 KST
const START_MS = Date.parse(START);

test("a past recruiting class has started and is not upcoming", () => {
  assert.equal(classHasStarted(START, START_MS + 1), true);
  assert.equal(isUpcomingClass(START, START_MS + 1), false);
});

test("a future recruiting class has not started and is upcoming", () => {
  assert.equal(classHasStarted(START, START_MS - 1), false);
  assert.equal(isUpcomingClass(START, START_MS - 1), true);
});

test("the exact start instant counts as started, matching join_class", () => {
  assert.equal(classHasStarted(START, START_MS), true);
  assert.equal(isUpcomingClass(START, START_MS), false);
});

test("KST wall-clock timestamps are compared as instants, not calendar strings", () => {
  const kst = "2026-11-02T20:00:00+09:00";
  assert.equal(Date.parse(kst), START_MS);
  assert.equal(classHasStarted(kst, START_MS), true);
  assert.equal(classHasStarted(kst, START_MS - 1), false);
});

test("upcoming filter uses a timestamptz instant and is exclusive of now", () => {
  const filter = upcomingScheduledAtFilter(START_MS);
  assert.equal(filter, `scheduled_at=gt.${encodeURIComponent(START)}`);
});

test("invalid start times fail closed", () => {
  assert.equal(classHasStarted("not-a-date", START_MS), true);
  assert.equal(isUpcomingClass("not-a-date", START_MS), false);
});

test("class_started RPC messages are detected", () => {
  assert.equal(isClassStartedError(CLASS_STARTED_CODE), true);
  assert.equal(isClassStartedError("ERROR: class_started"), true);
  assert.equal(isClassStartedError("already joined"), false);
});
