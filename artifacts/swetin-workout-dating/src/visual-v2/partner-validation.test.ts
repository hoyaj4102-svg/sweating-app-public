import test from "node:test";
import assert from "node:assert/strict";
import { isSafeWebsite, validatePartnerInput, type PartnerInput } from "./partner-validation.ts";
const valid: PartnerInput = {
  gymName: "가상 테스트 체육관", contactName: "가상 담당자", phone: "010-0000-1234",
  email: "partner@example.invalid", region: "예시시", address: "가상 테스트 주소",
  sports: ["러닝"], intro: "입력 검증을 위한 가상 소개", website: "", consent: true,
};
test("complete fictional form passes without requiring registration document or payment details", () => assert.deepEqual(validatePartnerInput(valid), {}));
test("all required fields and consent are validated", () => {
  const errors = validatePartnerInput({ gymName: "", contactName: "", phone: "", email: "", region: "", address: "", sports: [], intro: "", website: "", consent: false });
  assert.equal(Object.keys(errors).length, 9);
});
test("optional website never accepts credentials, scripts, unsafe schemes or malformed addresses", () => {
  for (const value of ["", "https://example.org/gym", "http://example.org"]) assert.equal(isSafeWebsite(value), true);
  for (const value of ["javascript:alert(1)", "data:text/html,test", "//example.org", "https://u:pw@example.org", "https://", "https://example.org/\nsecret"]) assert.equal(isSafeWebsite(value), false);
  assert.ok(validatePartnerInput({ ...valid, phone: "123", email: "invalid", website: "javascript:alert(1)" }).website);
});
