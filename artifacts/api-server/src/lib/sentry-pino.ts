/**
 * One capture path for the existing pino logger.
 * Error and fatal become Sentry events. No level is forwarded as a Sentry log,
 * so info and warn stay in pino and the redact list on that logger is the only log filter.
 */
export const sentryPinoCapture = {
  errorLevels: ["error", "fatal"] as const,
  logLevels: [] as const,
};
