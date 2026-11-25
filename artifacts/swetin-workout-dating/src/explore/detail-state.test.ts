import assert from "node:assert/strict";
import test from "node:test";
import type { ClassDetail } from "@workspace/api-client-react";
import { applySampleState, classHasStarted, getDetailCtaState, parseSampleState, recruitmentBadge, SAMPLE_STATES } from "./detail-state.ts";
import { DETAIL_META, TIER_LABEL } from "./detail-content.ts";

test("participation states distinguish open, full, joined, completed and unavailable", () => {
  const open = { status: "published", isJoined: false, remaining: 2 };
  assert.deepEqual(getDetailCtaState(open), { kind: "open", label: "참가 신청하기", disabled: false });
  assert.equal(getDetailCtaState({ ...open, remaining: 0 }).label, "모집 마감");
  assert.equal(getDetailCtaState({ ...open, isJoined: true }).label, "신청 완료");
  assert.equal(getDetailCtaState({ ...open, status: "completed", isJoined: true }).label, "운동 완료");
  for (const status of ["draft", "cancelled", "unknown"]) {
    assert.deepEqual(getDetailCtaState({ ...open, status }), { kind: "unavailable", label: "참가 불가", disabled: true });
  }
  assert.equal(getDetailCtaState({ ...open, remaining: 0 }).disabled, true);
});

test("gender-full is clearly a sample state and cannot enable the button", () => {
  for (const genderLabel of ["남성", "여성"]) {
    const cta = getDetailCtaState({ status: "published", isJoined: false, remaining: 2, genderBlocked: true, genderLabel });
    assert.equal(cta.disabled, true);
    assert.equal(cta.label, `${genderLabel} 정원 마감 (샘플)`);
  }
});

test("sample state overrides never book, mutate the seed or alter count totals", () => {
  const item = { status: "published", is_joined: false, capacity: 8, participant_count: 6, remaining_slots: 2 } as ClassDetail;
  for (const state of SAMPLE_STATES) {
    const shown = applySampleState(item, state);
    assert.equal(shown.capacity, 8);
    assert.equal(shown.participant_count, 6);
    assert.equal(shown.remaining_slots, 2);
    assert.equal(shown.participant_count + shown.remaining_slots, shown.capacity);
  }
  assert.equal(applySampleState(item, "joined").is_joined, true);
  assert.equal(applySampleState(item, "completed").status, "completed");
  assert.equal(applySampleState(item, "cancelled").status, "cancelled");
  assert.equal(applySampleState(item, "draft").status, "draft");
  assert.equal(item.is_joined, false);
  assert.equal(item.status, "published");
});

test("unknown sample state is rejected and every supported state is parsed", () => {
  for (const state of SAMPLE_STATES) assert.equal(parseSampleState(state), state);
  for (const value of [null, undefined, "paid", "logged-in", "../admin"]) assert.equal(parseSampleState(value), null);
});

test("all eight seeds have distinct honest metadata and both sample price tiers", () => {
  assert.equal(Object.keys(DETAIL_META).length, 8);
  for (const id of ["demo-sunset-run", "demo-boxing-basic", "demo-tennis-rally", "demo-bouldering", "demo-yoga-flow", "demo-surf-lesson"]) {
    assert.ok(DETAIL_META[id].difficulty);
    assert.ok(DETAIL_META[id].beginner);
    assert.match(DETAIL_META[id].refund, /샘플/);
    assert.match(DETAIL_META[id].refund, /공식.*아닙니다/);
  }
  assert.equal(TIER_LABEL[DETAIL_META["demo-boxing-basic"].tier], "Social Class");
  assert.equal(TIER_LABEL[DETAIL_META["demo-tennis-rally"].tier], "Premium Class");
  assert.equal(DETAIL_META["an-actual-server-class"], undefined);
});

test("a started published class reports 모집 마감 and is not joinable", () => {
  const start = "2026-11-02T11:00:00.000Z";
  const now = Date.parse(start);
  const open = { status: "published", isJoined: false, remaining: 4, scheduledAt: start };
  assert.deepEqual(getDetailCtaState(open, now), { kind: "closed", label: "모집 마감", disabled: true });
  assert.equal(recruitmentBadge(open.status, open.remaining, open.scheduledAt, now), "모집 마감");
  assert.equal(classHasStarted(start, now), true);
});

test("a future published class stays open, including one millisecond before start", () => {
  const start = "2026-11-02T11:00:00.000Z";
  const before = Date.parse(start) - 1;
  const open = { status: "published", isJoined: false, remaining: 4, scheduledAt: start };
  assert.deepEqual(getDetailCtaState(open, before), { kind: "open", label: "참가 신청하기", disabled: false });
  assert.equal(recruitmentBadge(open.status, open.remaining, open.scheduledAt, before), "모집 중");
  assert.equal(classHasStarted(start, before), false);
});

test("already joined stays 신청 완료 even after the class has started", () => {
  const start = "2026-11-02T20:00:00+09:00";
  const now = Date.parse("2026-11-02T11:00:00.000Z");
  const cta = getDetailCtaState({ status: "published", isJoined: true, remaining: 3, scheduledAt: start }, now);
  assert.deepEqual(cta, { kind: "joined", label: "신청 완료", disabled: true });
  assert.equal(recruitmentBadge("published", 3, start, now), "모집 마감");
});
