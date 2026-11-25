import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("profile screen stores older preference on the existing age_preference column", () => {
  const source = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  assert.equal(source.includes("age_preference"), true);
  assert.equal(source.includes("switch-older-preference"), true);
  assert.equal(source.includes("연상 선호"), true);
  assert.equal(source.includes("input-birth-year"), true);
  assert.equal(source.includes("바로 위 한 구간이 열립니다."), true);
  assert.equal(source.includes("radio-age-same"), false);
  assert.equal(source.includes("radio-age-both"), false);
});
