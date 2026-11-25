import assert from "node:assert/strict";
import test from "node:test";
import {
  ageBandForBirthYear,
  ageFromBirthYear,
  birthYearBounds,
  classVisibleToViewer,
  joinBandError,
  memberCanJoinAgeBand,
  seoulYear,
} from "../src/lib/age-band.ts";

const now = new Date("2026-11-06T03:00:00.000Z");
const year = 2026;

test("seoul year and the three bands use the calendar year, not a birthday", () => {
  assert.equal(seoulYear(now), year);
  assert.equal(ageFromBirthYear(year - 20, now), 20);
  assert.equal(ageBandForBirthYear(year - 19, now), null);
  assert.equal(ageBandForBirthYear(year - 20, now), "20_25");
  assert.equal(ageBandForBirthYear(year - 25, now), "20_25");
  assert.equal(ageBandForBirthYear(year - 26, now), "26_35");
  assert.equal(ageBandForBirthYear(year - 28, now), "26_35");
  assert.equal(ageBandForBirthYear(year - 29, now), "26_35");
  assert.equal(ageBandForBirthYear(year - 35, now), "26_35");
  assert.equal(ageBandForBirthYear(year - 36, now), "36_45");
  assert.equal(ageBandForBirthYear(year - 38, now), "36_45");
  assert.equal(ageBandForBirthYear(year - 39, now), "36_45");
  assert.equal(ageBandForBirthYear(year - 45, now), "36_45");
  assert.equal(ageBandForBirthYear(year - 46, now), null);
  assert.deepEqual(birthYearBounds(now), { min: year - 45, max: year - 20 });
});

test("join allows the same band, one band up when asked, and three years into a lower band", () => {
  const cases: Array<[number, "same_band" | "both", string | null, boolean]> = [
    [20, "same_band", "20_25", true],
    [20, "same_band", "26_35", false],
    [20, "both", "26_35", true],
    [20, "both", "36_45", false],
    [25, "same_band", "20_25", true],
    [25, "both", "36_45", false],
    [26, "same_band", "20_25", true],
    [26, "same_band", "36_45", false],
    [26, "both", "36_45", true],
    [28, "same_band", "20_25", true],
    [29, "same_band", "20_25", false],
    [29, "both", "20_25", false],
    [35, "same_band", "36_45", false],
    [35, "both", "36_45", true],
    [36, "same_band", "26_35", true],
    [36, "both", "20_25", false],
    [38, "same_band", "26_35", true],
    [39, "both", "26_35", false],
    [45, "both", "36_45", true],
    [45, "both", "26_35", false],
    [46, "both", "36_45", false],
    [46, "both", null, true],
    [20, "same_band", null, true],
  ];
  for (const [age, preference, band, allowed] of cases) {
    assert.equal(
      memberCanJoinAgeBand(year - age, preference, band, now),
      allowed,
      `${age} ${preference} ${band}`,
    );
  }
});

test("class list stays visible while join reports eligibility", () => {
  const viewer = { birthYear: year - 25, agePreference: "same_band", isAdmin: false };
  assert.equal(classVisibleToViewer("20_25", null), true);
  assert.equal(classVisibleToViewer(null, null), true);
  assert.equal(classVisibleToViewer("36_45", viewer), true);
  assert.equal(classVisibleToViewer("20_25", viewer), true);
  assert.equal(classVisibleToViewer(null, { birthYear: year - 36, agePreference: "both", isAdmin: true }), true);
  assert.equal(joinBandError(null, viewer, now), null);
  assert.equal(joinBandError("36_45", viewer, now), "이 연령 구간에는 참가할 수 없어요.");
  assert.equal(joinBandError("26_35", { ...viewer, agePreference: "both" }, now), null);
  assert.equal(joinBandError("36_45", { birthYear: null, agePreference: "both", isAdmin: false }, now), "출생 연도를 저장한 뒤 참가할 수 있어요.");
  assert.equal(joinBandError("36_45", { birthYear: year - 20, agePreference: "same_band", isAdmin: true }, now), null);
  const bounds = birthYearBounds(now);
  assert.equal(joinBandError("20_25", { birthYear: bounds.max, agePreference: "same_band", isAdmin: false }, now), null);
  assert.equal(joinBandError("36_45", { birthYear: bounds.min, agePreference: "same_band", isAdmin: false }, now), null);
  assert.equal(joinBandError("20_25", { birthYear: bounds.max + 1, agePreference: "both", isAdmin: false }, now), "출생 연도를 저장한 뒤 참가할 수 있어요.");
  assert.equal(joinBandError("36_45", { birthYear: bounds.min - 1, agePreference: "both", isAdmin: false }, now), "출생 연도를 저장한 뒤 참가할 수 있어요.");
  assert.equal(ageBandForBirthYear(bounds.max, now), "20_25");
  assert.equal(ageBandForBirthYear(bounds.min, now), "36_45");
});
