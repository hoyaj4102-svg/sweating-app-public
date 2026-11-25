export type ViteDevSettings = {
  port: number;
  basePath: string;
  apiProxyTarget: string;
};

type DevEnvironment = Record<string, string | undefined>;

function present(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return value.trim() === "" ? undefined : value;
}

/** Local Vite no longer requires Replit to inject PORT and BASE_PATH. */
export function resolveViteDevSettings(environment: DevEnvironment = process.env): ViteDevSettings {
  const rawPort = present(environment.PORT) ?? "5173";
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid PORT value: "${rawPort}"`);
  }

  return {
    port,
    basePath: present(environment.BASE_PATH) ?? "/",
    apiProxyTarget: present(environment.API_PROXY_TARGET) ?? "http://127.0.0.1:8787",
  };
}
