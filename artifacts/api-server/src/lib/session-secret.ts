import { randomBytes } from "node:crypto";

type SessionEnvironment = {
  [key: string]: string | undefined;
  NODE_ENV?: string;
  SESSION_SECRET?: string;
};

let developmentSecret: string | undefined;

/** Keep configured signing keys unchanged; never persist or log an ephemeral key. */
export function resolveSessionSecret(environment: SessionEnvironment = process.env): string {
  const configured = environment.SESSION_SECRET;
  if (configured && configured.trim().length > 0) return configured;

  // Fail closed for production, unset modes and all modes other than explicit development.
  if (environment.NODE_ENV !== "development") {
    throw new Error("SESSION_SECRET must be configured before server startup outside development.");
  }

  // One cryptographically random key per process, stable until that process exits.
  developmentSecret ??= randomBytes(48).toString("base64url");
  return developmentSecret;
}
