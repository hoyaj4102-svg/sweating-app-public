import assert from "node:assert/strict";
import test from "node:test";
import { sentryPinoCapture } from "../src/lib/sentry-pino.ts";

test("pino capture sends only error and fatal, and no Sentry log levels", () => {
  assert.deepEqual([...sentryPinoCapture.errorLevels], ["error", "fatal"]);
  assert.deepEqual([...sentryPinoCapture.logLevels], []);
});
