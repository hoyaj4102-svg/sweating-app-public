import assert from "node:assert/strict";
import test from "node:test";
import { EMPTY_CONSENT, consentReady, needsConsentGate } from "./consent.ts";

test("all three consents are required and overseas transfer is separate", () => {
  assert.equal(consentReady(EMPTY_CONSENT), false);
  assert.equal(consentReady({ terms: true, privacy: true, overseas_transfer: false }), false);
  assert.equal(consentReady({ terms: true, privacy: false, overseas_transfer: true }), false);
  assert.equal(consentReady({ terms: false, privacy: true, overseas_transfer: true }), false);
  assert.equal(consentReady({ terms: true, privacy: true, overseas_transfer: true }), true);
});

test("a member without the current consent is stopped except on the legal pages", () => {
  assert.equal(needsConsentGate(false, "/home"), true);
  assert.equal(needsConsentGate(undefined, "/profile"), true);
  assert.equal(needsConsentGate(false, "/privacy"), false);
  assert.equal(needsConsentGate(false, "/terms"), false);
  assert.equal(needsConsentGate(true, "/home"), false);
});
