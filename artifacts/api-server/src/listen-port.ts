type PortEnvironment = {
  NODE_ENV?: string;
  PORT?: string;
};

/** Production must be told a port. Local development defaults to the Vite proxy target. */
export function resolveListenPort(environment: PortEnvironment = process.env): number {
  const fallback = environment.NODE_ENV === "production" ? undefined : "8787";
  const rawPort = environment.PORT ?? fallback;

  if (!rawPort) {
    throw new Error("PORT environment variable is required but was not provided.");
  }

  const port = Number(rawPort);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid PORT value: "${rawPort}"`);
  }

  return port;
}
