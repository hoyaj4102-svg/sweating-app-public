import test from "node:test";
import assert from "node:assert/strict";
import { campaignParams, withCampaign } from "./campaign.ts";
import { buildHomeUrl, parseHome, safeHomeReturn } from "../explore/home-filters.ts";
import { classLoginUrl, parseClassReturn } from "../explore/auth-return.ts";

test("start CTA preserves supported UTM tracking and drops the unsupported bare campaign parameter", () => {
  assert.equal(withCampaign("/start", "utm_campaign=qa"), "/start?utm_campaign=qa");
  assert.equal(withCampaign("/start", "campaign=qa"), "/start");
  assert.equal(withCampaign("/start", "campaign=qa&utm_source=preview&utm_campaign=qa"), "/start?utm_source=preview&utm_campaign=qa");
});

test("five UTM fields retain Korean/space/literal percent while unknown input is not forwarded", () => {
  const campaign = new URLSearchParams({
    utm_source: "instagram", utm_medium: "social", utm_campaign: "함께 운동 50%20",
    utm_term: "러닝", utm_content: "reel-1", next: "https://evil.example",
  });
  const path = withCampaign("/home?sport=%EB%B3%B5%EC%8B%B1&open=1", campaign.toString());
  const params = new URLSearchParams(path.split("?")[1]);
  assert.equal(params.get("utm_campaign"), "함께 운동 50%20");
  for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"]) assert.equal(params.get(key), campaign.get(key));
  assert.equal(params.has("next"), false);
  assert.equal(params.get("open"), "1");
  assert.equal(params.get("sport"), "복싱");
});
test("home filter, card, detail return and login nesting preserve campaign without double decoding", () => {
  const raw = new URLSearchParams({ utm_source: "tiktok", utm_campaign: "샘플해변 50%20" }).toString();
  const state = { sport: "러닝", q: "샘플해변 50%20", view: "map" as const, open: true, free: true };
  const home = withCampaign(buildHomeUrl(state), raw);
  assert.equal(safeHomeReturn(home), home);
  assert.deepEqual(parseHome(home.split("?")[1]), state);
  const detail = withCampaign(`/classes/demo-sunset-run?back=${encodeURIComponent(home)}`, raw);
  const parsed = parseClassReturn(classLoginUrl(detail).split("?")[1]);
  assert.equal(parsed, detail);
  const detailParams = new URLSearchParams(parsed!.split("?")[1]);
  assert.equal(detailParams.get("back"), home);
  assert.equal(detailParams.get("utm_campaign"), "샘플해변 50%20");
});
test("campaign formatter cannot accept external or unknown destinations", () => {
  for (const path of ["https://evil.example", "//evil", "/admin", "/home#evil", "/classes/../admin", "/%2f%2fevil"]) assert.throws(() => withCampaign(path, ""));
  for (const path of ["/", "/home", "/about", "/partners", "/start", "/signup", "/preview/workout", "/preview/wallet", "/preview/interests"]) assert.equal(withCampaign(path, ""), path);
});
test("untrusted oversized tracking values stay within existing nested-return length boundaries", () => {
  const source = new URLSearchParams({ utm_source: "가".repeat(300), utm_medium: "나".repeat(300), utm_campaign: "다".repeat(300), utm_content: "x", utm_term: "\n" });
  assert.ok(campaignParams(source.toString()).toString().length <= 360);
  assert.equal(campaignParams(source.toString()).has("utm_term"), false);
  const home = withCampaign(buildHomeUrl({sport: "복싱", q: "가".repeat(60), view: "map", open: true, free: true}), source.toString());
  assert.equal(safeHomeReturn(home), home);
  const detail = `/classes/demo-boxing-basic?back=${encodeURIComponent(home)}`;
  assert.equal(parseClassReturn(classLoginUrl(detail).split("?")[1]), detail);
});
