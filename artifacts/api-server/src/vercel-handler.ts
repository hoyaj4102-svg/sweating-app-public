import "./instrument";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createApp } from "./create-app";
import { normalizeFunctionUrl } from "./function-url";
import { logger } from "./lib/logger";

type AppInstance = ReturnType<typeof createApp>;

let app: AppInstance | undefined;

function getApp(): AppInstance {
  app ??= createApp();
  return app;
}

/**
 * Node.js request listener for one Vercel Function.
 * Configuration is checked on the first request so a build without runtime env can load this module.
 */
export default function handler(req: IncomingMessage, res: ServerResponse): void {
  let application: AppInstance;
  try {
    application = getApp();
  } catch (error) {
    logger.error({ err: error }, "API configuration refused the request");
    res.statusCode = 503;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: "API server is not configured." }));
    return;
  }

  req.url = normalizeFunctionUrl(req.url);
  application(req, res);
}
