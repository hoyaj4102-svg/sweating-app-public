import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const LEAD = "관장님, 저희는 체육관의 빈 시간을 빌리는 게 아닙니다.";
const BODY = [
  "평소 체육관에 올 이유가 없었던 남녀에게 운동할 이유와 새로운 사람을 만날 이유를 만들어 드리는 겁니다.",
  "그리고 그 경험이 체육관의 잠재 고객과 신규 회원으로 돌아오게 만들겠습니다.",
];
const LEAD_LINES = ["관장님, 저희는", "체육관의 빈 시간을", "빌리는 게 아닙니다."];
const BODY_LINES = [
  ["평소 체육관에 올 이유가 없었던 남녀에게", "운동할 이유와 새로운 사람을 만날 이유를", "만들어 드리는 겁니다."],
  ["그리고 그 경험이 체육관의 잠재 고객과", "신규 회원으로 돌아오게 만들겠습니다."],
];

function splitLines(inner: string) {
  return inner.split(/<br\s*\/?>/).map(part => part.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()).filter(Boolean);
}

function innerOf(source: string, pattern: RegExp) {
  const match = source.match(pattern);
  assert.ok(match, pattern.source);
  return match[1];
}

test("partner promise keeps the founder sentences and breaks only at existing spaces", () => {
  const page = readFileSync(new URL("./PartnersPage.tsx", import.meta.url), "utf8");
  const promise = page.slice(page.indexOf('data-testid="section-partner-promise"'), page.indexOf('id="partner-form"'));
  const lead = splitLines(innerOf(promise, /data-testid="text-partner-promise-lead">([\s\S]*?)<\/p>/));
  const paragraphs = [...promise.matchAll(/<div className="vv-body">([\s\S]*?)<\/div>/g)]
    .flatMap(match => [...match[1].matchAll(/<p>([\s\S]*?)<\/p>/g)].map(part => splitLines(part[1])));
  assert.deepEqual(lead, LEAD_LINES);
  assert.deepEqual(paragraphs, BODY_LINES);
  assert.equal(lead.join(" "), LEAD);
  assert.deepEqual(paragraphs.map(lines => lines.join(" ")), BODY);
  assert.equal(promise.includes("vv-h2"), false);
  assert.equal(promise.includes("vv-eyebrow"), false);
  assert.equal(promise.includes("white-space"), false);
  for (const removed of ["REVENUE MODEL", "클래스 수익모델", "SOCIAL CLASS", "PREMIUM CLASS", "19,900", "수수료", "vv-model", "vv-flag", "note-business-assumption", "가격과 수수료는"]) {
    assert.equal(page.includes(removed), false, removed);
  }
  assert.match(page, /파트너 혜택/);
  assert.match(page, /data-testid="button-partner-submit"/);
  assert.match(page, /입력한 내용은 저장되거나 서버로 전송되지 않습니다/);
  assert.match(page, /제휴 신청 화면을 미리 체험했습니다/);
  const images = [...promise.matchAll(/<img\b/g)];
  assert.equal(images.length, 1);
  assert.match(promise, /data-testid="img-partner-promise"/);
  assert.match(promise, /alt="체육관 바닥에서 나란히 플랭크를 하는 남녀"/);
  assert.match(promise, /width=\{1024\}/);
  assert.match(promise, /height=\{646\}/);
  assert.equal(promise.includes("스쿼트"), false);
  assert.equal(page.includes("partner-workout"), false);
  assert.ok(promise.indexOf("img-partner-promise") > promise.indexOf('className="vv-body"'));
  assert.match(page, /partner-plank\.jpg/);
});

test("option 3 typography stays on the promise section and leaves the shared scale unchanged", () => {
  const visual = readFileSync(new URL("./visual.css", import.meta.url), "utf8");
  const campaign = readFileSync(new URL("../campaign-marketing.css", import.meta.url), "utf8");
  for (const css of [visual, campaign]) {
    assert.equal(css.includes(".vv-model"), false);
    assert.equal(css.includes(".vv-flag"), false);
    assert.equal(css.includes("Gothic A1"), false);
  }
  const promiseCss = visual.slice(visual.indexOf(".vv-partners .vv-promise-sec"), visual.indexOf(".vv-form"));
  assert.equal(promiseCss.includes("nowrap"), false);
  assert.equal(promiseCss.includes("font-family"), false);
  assert.match(visual, /\.vv-sub \{ margin: 0 0 8px; font-size: clamp\(17px, 4\.4vw, 22px\); font-weight: 700; \}/);
  assert.match(visual, /\.vv-body \{ max-width: 560px; margin-top: 28px; display: grid; gap: 14px; font-size: 17px; line-height: 1\.75; color: var\(--vv-muted\); \}/);
  assert.match(visual, /\.vv-h2 \{ font-size: clamp\(32px, 8vw, 68px\); line-height: 1\.1; letter-spacing: -\.06em; margin-top: 18px !important; \}/);
  assert.match(visual, /\.vv-sec \{ padding: 88px 0; background: #fff; \}/);
  assert.match(visual, /\.vv-partners \.vv-promise-sec \{ padding-top: 64px; padding-bottom: 72px; \}/);
  assert.match(visual, /\.vv-promise \{ max-width: 40rem; \}/);
  assert.match(visual, /\.vv-promise \.vv-sub \{ margin: 0; font-size: 36px; font-weight: 700; line-height: 1\.30; letter-spacing: -0\.025em; word-break: keep-all; overflow-wrap: break-word; \}/);
  assert.match(visual, /\.vv-promise \.vv-body \{ max-width: none; margin-top: 48px; gap: 24px; font-size: 18px; line-height: 1\.9; word-break: keep-all; overflow-wrap: break-word; \}/);
  assert.equal(visual.split("font-size: 36px").length, 2);
  assert.match(visual, /\.vv-promise-photo \{ display: block; width: 100%; max-width: 100%; height: auto; margin-top: 32px; aspect-ratio: 1024 \/ 646; object-fit: contain; \}/);
  assert.match(visual, /@media \(min-width: 900px\) \{\s*\.vv-partners \.vv-promise-layout \{ display: grid; grid-template-columns: minmax\(26rem, 28rem\) minmax\(0, 1fr\); column-gap: 64px; align-items: start; \}/);
  assert.match(visual, /\.vv-choice \{ grid-template-columns: 1fr 1fr; \}/);
});
