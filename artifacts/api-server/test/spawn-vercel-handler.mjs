import { createServer } from "node:http";
import handler from "../dist/vercel-handler.mjs";

const requestPath = process.env.HANDLER_PATH ?? "/api/healthz";
const server = createServer((req, res) => {
  handler(req, res);
});

server.listen(0, "127.0.0.1", async () => {
  const address = server.address();
  const port = address && typeof address === "object" ? address.port : 0;
  const headers = {};
  if (process.env.HANDLER_ORIGIN) headers.Origin = process.env.HANDLER_ORIGIN;
  if (process.env.HANDLER_AC_REQUEST_METHOD) {
    headers["Access-Control-Request-Method"] = process.env.HANDLER_AC_REQUEST_METHOD;
  }
  try {
    const response = await fetch(`http://127.0.0.1:${port}${requestPath}`, {
      method: process.env.HANDLER_METHOD ?? "GET",
      headers,
    });
    if (process.env.HANDLER_REPORT === "cors") {
      process.stdout.write(JSON.stringify({
        status: response.status,
        allowOrigin: response.headers.get("access-control-allow-origin"),
        allowCredentials: response.headers.get("access-control-allow-credentials"),
      }));
    } else {
      process.stdout.write(String(response.status));
    }
  } catch {
    process.stderr.write("handler check failed\n");
    process.exitCode = 1;
  } finally {
    server.close();
  }
});
