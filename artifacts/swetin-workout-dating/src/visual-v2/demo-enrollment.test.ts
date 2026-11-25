import test from "node:test";
import assert from "node:assert/strict";
import { createDemoEnrollment, confirmDemoEnrollment, demoModeEnabled, DEFAULT_DEMO_CLASS_ID } from "./demo-enrollment.ts";

test("explicit flag enables only development, never production", () => {
  assert.equal(demoModeEnabled(true, "true"), true);
  for (const flag of [undefined, "false", "TRUE", "1", "true"]) {
    assert.equal(demoModeEnabled(false, flag), false);
    if (flag !== "true") assert.equal(demoModeEnabled(true, flag), false);
  }
});

test("selecting a fictional class is not joining; confirmation is immutable and idempotent", () => {
  const selected = createDemoEnrollment("demo-boxing-basic", "/classes/demo-boxing-basic?back=%2Fhome");
  assert.equal(selected.joined, false);
  const joined = confirmDemoEnrollment(selected)!;
  assert.equal(joined.joined, true);
  assert.equal(selected.joined, false);
  assert.equal(confirmDemoEnrollment(joined), joined);
  assert.equal(confirmDemoEnrollment(null), null);
});

test("real identifiers cannot be enrollment targets and external return URLs are rejected", () => {
  const e = createDemoEnrollment("real-account-class-uuid", "https://example.org");
  assert.equal(e.classId, DEFAULT_DEMO_CLASS_ID);
  assert.equal(e.returnTo, null);
  assert.equal(confirmDemoEnrollment({ ...e, classId: "real-class" }), null);
  for (const href of ["//example.org", "/admin", "/classes/demo-boxing-basic#external", "/classes/a next"]) {
    assert.equal(createDemoEnrollment("demo-boxing-basic", href).returnTo, null);
  }
});
