import assert from "node:assert/strict";
import test from "node:test";
import { DRAFT_BANNER, LEGAL_DOCUMENT_VERSION, legalPlainText } from "./documents.ts";

test("legal draft names the processors and leaves the business identity blank", () => {
  const text = legalPlainText();
  assert.match(text, new RegExp(DRAFT_BANNER));
  assert.match(text, /\[사업자 상호\]/);
  assert.match(text, /\[대표자\]/);
  assert.match(text, /\[연락처\]/);
  assert.match(text, /\[N\]/);
  assert.match(text, /Supabase Tokyo/);
  assert.match(text, /Supabase Pte\. Ltd\./);
  assert.match(text, /싱가포르/);
  assert.match(text, /유럽연합/);
  assert.match(text, /미국/);
  assert.match(text, /Vercel Inc\./);
  assert.equal(text.includes("주식회사"), false);
  assert.equal(text.includes(LEGAL_DOCUMENT_VERSION), true);
  assert.equal((text.match(/Inc\./g) ?? []).length, 1);
});
