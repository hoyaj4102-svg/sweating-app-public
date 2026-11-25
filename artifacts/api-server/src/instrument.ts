import * as Sentry from "@sentry/node";
import { buildSentryRuntimeOptions, createInternalUserId, scrubBeforeBreadcrumb, scrubBeforeSend, scrubBeforeSendTransaction } from "@workspace/sentry-privacy";
import { sentryPinoCapture } from "./lib/sentry-pino";

// Loaded before the app logger. pinoIntegration watches that one logger; it does not create another.
const runtime = buildSentryRuntimeOptions({
  dsn: process.env.SENTRY_DSN,
  vercelEnv: process.env.VERCEL_ENV,
  release: process.env.VERCEL_GIT_COMMIT_SHA,
});

if (runtime.enabled && runtime.dsn) {
  try {
    const internalUserId = createInternalUserId();
    Sentry.init({
      dsn: runtime.dsn,
      environment: runtime.environment,
      release: runtime.release,
      sendDefaultPii: runtime.sendDefaultPii,
      tracesSampleRate: runtime.tracesSampleRate,
      enableLogs: runtime.enableLogs,
      includeLocalVariables: runtime.includeLocalVariables,
      registerEsmLoaderHooks: false,
      integrations(defaults) {
        return [
          ...defaults.filter((integration) => integration.name !== "Pino"),
          Sentry.pinoIntegration({
            error: { levels: [...sentryPinoCapture.errorLevels] },
            log: { levels: [...sentryPinoCapture.logLevels] },
          }),
        ];
      },
      beforeSend(event) {
        return scrubBeforeSend(event, { internalUserId });
      },
      beforeSendTransaction(event) {
        return scrubBeforeSendTransaction(event, { internalUserId });
      },
      beforeBreadcrumb(breadcrumb) {
        return scrubBeforeBreadcrumb(breadcrumb);
      },
    });
  } catch {
    // A rejected SDK setup leaves the logger uninstrumented.
  }
}
