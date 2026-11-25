import express, { type ErrorRequestHandler, type Express } from "express";
import pinoHttp from "pino-http";
import router from "./routes";
import { createCorsMiddleware } from "./lib/cors";
import { logger } from "./lib/logger";
import {
  beginRequestTiming,
  bindTiming,
  emptyBuckets,
  runWithTiming,
  scrubLogPath,
  serverTimingEnabled,
  serverTimingHeader,
  stampServerTiming,
  timingLogFields,
  timingStateFor,
} from "./lib/request-timing";
import { sessionCookieParser } from "./lib/session-cookie";
import { resolveSessionSecret } from "./lib/session-secret";

const unhandledError: ErrorRequestHandler = (error, _request, response, _next) => {
  logger.error({ err: error }, "Unhandled API error");
  if (response.headersSent) {
    return;
  }
  response.status(500).json({ error: "요청을 처리하지 못했습니다." });
};

/** Build the API app. Validates the session signing key and CORS allowlist when called, not at import. */
export function createApp(): Express {
  const sessionSecret = resolveSessionSecret();
  const corsMiddleware = createCorsMiddleware();
  const app: Express = express();

  app.use((request, response, next) => {
    const state = beginRequestTiming();
    bindTiming(response, state);
    stampServerTiming(response, () => {
      state.totalMs ??= performance.now() - state.started;
      if (!serverTimingEnabled()) return null;
      return serverTimingHeader(state.buckets, state.totalMs);
    });
    runWithTiming(state.buckets, () => next());
  });
  app.use(
    pinoHttp({
      logger,
      customProps(req, res) {
        const state = timingStateFor(res);
        return timingLogFields({
          path: typeof req.url === "string" ? req.url : "",
          buckets: state?.buckets ?? emptyBuckets(),
          totalMs: state?.totalMs ?? 0,
        });
      },
      serializers: {
        req(req) {
          return {
            id: req.id,
            method: req.method,
            url: scrubLogPath(req.url),
          };
        },
        res(res) {
          return {
            statusCode: res.statusCode,
          };
        },
      },
    }),
  );
  app.use(corsMiddleware);
  app.use(sessionCookieParser(sessionSecret));
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  app.use("/api", router);
  app.use("/api", (_request, response) => {
    response.status(404).json({ error: "요청한 API를 찾을 수 없습니다." });
  });
  app.use(unhandledError);

  return app;
}
