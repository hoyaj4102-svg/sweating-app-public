import * as Sentry from "@sentry/react";
import {
  buildSentryRuntimeOptions,
  createInternalUserId,
  scrubBeforeBreadcrumb,
  scrubBeforeSend,
  scrubBeforeSendTransaction,
} from "@workspace/sentry-privacy";
import { registerBrowserCapture } from "@/sentry-capture";

declare global {
  const __SWEATING_VERCEL_ENV__: string;
  const __SWEATING_VERCEL_GIT_COMMIT_SHA__: string;
}

/** Browser SDK. No-op unless `VITE_SENTRY_DSN` was present at build time. */
export function initBrowserSentry(): void {
  try {
    const runtime = buildSentryRuntimeOptions({
      dsn: import.meta.env.VITE_SENTRY_DSN,
      vercelEnv: __SWEATING_VERCEL_ENV__,
      release: __SWEATING_VERCEL_GIT_COMMIT_SHA__,
    });
    if (!runtime.enabled || !runtime.dsn) return;
    const internalUserId = createInternalUserId();
    Sentry.init({
      dsn: runtime.dsn,
      environment: runtime.environment,
      release: runtime.release,
      sendDefaultPii: runtime.sendDefaultPii,
      tracesSampleRate: runtime.tracesSampleRate,
      enableLogs: runtime.enableLogs,
      replaysSessionSampleRate: runtime.replaysSessionSampleRate,
      replaysOnErrorSampleRate: runtime.replaysOnErrorSampleRate,
      integrations(defaults) {
        const withoutReplayOrDom = defaults.filter((integration) => {
          const name = integration.name;
          return name !== "Replay" && name !== "ReplayCanvas" && name !== "Breadcrumbs";
        });
        withoutReplayOrDom.push(
          Sentry.breadcrumbsIntegration({
            console: true,
            dom: false,
            fetch: true,
            history: true,
            xhr: true,
          }),
        );
        return withoutReplayOrDom;
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
    registerBrowserCapture((error) => {
      Sentry.captureException(error);
    });
  } catch {
    // A rejected SDK setup leaves the browser reporter off.
  }
}
