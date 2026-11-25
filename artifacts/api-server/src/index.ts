import "./instrument";
import app from "./app";
import { logger } from "./lib/logger";
import { resolveListenPort } from "./listen-port";

const port = resolveListenPort();

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
