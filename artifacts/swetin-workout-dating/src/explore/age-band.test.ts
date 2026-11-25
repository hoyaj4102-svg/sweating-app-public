import assert from "node:assert/strict";
import test from "node:test";
import { ageBandForBirthYear, ageBandLabel, birthYearBounds, joinEligibilityLabel, memberCanJoinAgeBand } from "./age-band.ts";

const now = new Date("2026-06-01T00:00:00.000Z");
const year = 2026;

test("frontend bands, labels, and eligibility follow the three-band rule", () => {
  assert.equal(ageBandForBirthYear(year - 25, now), "20_25");
  assert.equal(ageBandForBirthYear(year - 30, now), "26_35");
  assert.equal(ageBandForBirthYear(year - 40, now), "36_45");
  assert.equal(ageBandForBirthYear(year - 19, now), null);
  assert.equal(ageBandLabel("20_25"), "20-25세");
  assert.equal(ageBandLabel("26_35"), "26-35세");
  assert.equal(ageBandLabel("36_45"), "36-45세");
  assert.equal(ageBandLabel(null), "연령 제한 없음");
  assert.deepEqual(birthYearBounds(now), { min: year - 45, max: year - 20 });
  assert.equal(memberCanJoinAgeBand(year - 20, "both", "36_45", now), false);
  assert.equal(memberCanJoinAgeBand(year - 28, "same_band", "20_25", now), true);
  assert.equal(memberCanJoinAgeBand(year - 29, "same_band", "20_25", now), false);
  assert.equal(memberCanJoinAgeBand(year - 38, "same_band", "26_35", now), true);
  assert.equal(memberCanJoinAgeBand(year - 39, "both", "26_35", now), false);
  assert.equal(
    joinEligibilityLabel("26_35", { birthYear: year - 25, agePreference: "both", isAdmin: false }, now),
    "연상 선호로 참가할 수 있어요.",
  );
  assert.equal(
    joinEligibilityLabel("36_45", { birthYear: year - 20, agePreference: "both", isAdmin: false }, now),
    "이 연령 구간에는 참가할 수 없어요.",
  );
  assert.equal(joinEligibilityLabel("20_25", null, now), "로그인하면 참가 가능 여부를 확인할 수 있어요.");
  assert.equal(
    joinEligibilityLabel("36_45", { birthYear: year - 20, isAdmin: true }, now),
    "관리자는 연령과 관계없이 참가할 수 있어요.",
  );
});
