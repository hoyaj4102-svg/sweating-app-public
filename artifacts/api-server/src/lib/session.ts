import type { Request, Response } from "express";
import { supabaseJson, supabaseRequest } from "./supabase";

const SESSION_COOKIE = "swetin_session";
const SESSION_MAX_AGE = 1000 * 60 * 60 * 24 * 14;

export type Session = {
  accessToken: string;
  refreshToken?: string;
  user: {
    id: string;
    email: string;
  };
};

type AuthPayload = {
  access_token?: string;
  refresh_token?: string;
  user?: { id?: string; email?: string };
  // Confirm-required signup returns the user model itself, not `{ user, access_token }`.
  id?: string;
  email?: string;
};

export type OAuthAuthPayload = AuthPayload & {
  expires_in?: number;
  token_type?: string;
};

export function setSessionCookie(response: Response, session: Session): void {
  // `Response.req` is the serve-static core request. The signing secret is
  // added by cookie-parser and is not part of that core type.
  const secret = (response.req as { secret?: unknown } | undefined)?.secret;
  if (typeof secret !== "string" || secret.length === 0) {
    throw new Error("Session cookie secret is unavailable for this request");
  }
  response.cookie(SESSION_COOKIE, JSON.stringify(session), {
    signed: true,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_MAX_AGE,
  });
}

export function clearSessionCookie(response: Response): void {
  response.clearCookie(SESSION_COOKIE);
}

export function readSession(request: Request): Session | null {
  const raw = request.signedCookies?.[SESSION_COOKIE];
  if (!raw || typeof raw !== "string") return null;
  try {
    const parsed = JSON.parse(raw) as Session;
    if (!parsed.accessToken || !parsed.user?.id || !parsed.user?.email) return null;
    return parsed;
  } catch {
    return null;
  }
}

// One refresh per token while a request is in flight. Supabase rotates refresh
// tokens, and parallel calls with the same token can revoke the session.
const refreshInFlight = new Map<string, Promise<Session | null>>();

function sessionFromRefresh(payload: AuthPayload, previous: Session): Session | null {
  if (!payload.access_token || !payload.refresh_token || !payload.user?.id) return null;
  const email =
    payload.user.email ??
    (payload.user.id === previous.user.id ? previous.user.email : undefined);
  if (!email) return null;
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    user: { id: payload.user.id, email },
  };
}

function refreshAccessToken(previous: Session): Promise<Session | null> {
  const refreshToken = previous.refreshToken;
  if (!refreshToken) return Promise.resolve(null);

  const existing = refreshInFlight.get(refreshToken);
  if (existing) return existing;

  const pending = supabaseJson<AuthPayload>("/auth/v1/token?grant_type=refresh_token", {
    method: "POST",
    body: JSON.stringify({ refresh_token: refreshToken }),
  })
    .then((payload) => sessionFromRefresh(payload, previous))
    .catch(() => null)
    .finally(() => {
      if (refreshInFlight.get(refreshToken) === pending) {
        refreshInFlight.delete(refreshToken);
      }
    });

  refreshInFlight.set(refreshToken, pending);
  return pending;
}

export async function authenticate(
  request: Request,
  response: Response,
): Promise<Session | null> {
  const session = readSession(request);
  if (!session) return null;

  try {
    const user = await supabaseJson<{ id: string; email?: string }>(
      "/auth/v1/user",
      { method: "GET" },
      session.accessToken,
    );
    return {
      ...session,
      user: { id: user.id, email: user.email ?? session.user.email },
    };
  } catch {
    const renewed = await refreshAccessToken(session);
    if (!renewed) {
      clearSessionCookie(response);
      return null;
    }
    setSessionCookie(response, renewed);
    return renewed;
  }
}

export async function signInWithAuth(
  email: string,
  password: string,
  mode: "signup" | "login",
): Promise<{ session: Session | null; user: { id: string; email: string } }> {
  const path =
    mode === "signup"
      ? "/auth/v1/signup"
      : "/auth/v1/token?grant_type=password";
  const payload = await supabaseJson<AuthPayload>(path, {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });

  const user = mode === "signup" ? signupIdentity(payload, email) : loginIdentity(payload);
  if (!user) {
    throw new Error("Supabase did not return a user");
  }

  return {
    user,
    session:
      payload.access_token
        ? {
            accessToken: payload.access_token,
            refreshToken: payload.refresh_token,
            user,
          }
        : null,
  };
}

function loginIdentity(payload: AuthPayload): { id: string; email: string } | null {
  if (!payload.user?.id || !payload.user.email) return null;
  return { id: payload.user.id, email: payload.user.email };
}

function signupIdentity(payload: AuthPayload, submittedEmail: string): { id: string; email: string } | null {
  const id = payload.user?.id ?? payload.id;
  const email = payload.user?.email || payload.email || (id ? submittedEmail : "");
  if (!id || !email) return null;
  return { id, email };
}

export async function exchangeOAuthCode(
  code: string,
  codeVerifier: string,
): Promise<{ session: Session; user: { id: string; email: string } }> {
  const payload = await supabaseJson<OAuthAuthPayload>(
    "/auth/v1/token?grant_type=pkce",
    {
      method: "POST",
      body: JSON.stringify({
        auth_code: code,
        code_verifier: codeVerifier,
      }),
    },
  );

  if (!payload.access_token || !payload.user?.id) {
    throw new Error("Supabase did not return an OAuth session");
  }

  const email = payload.user.email ?? `oauth-${payload.user.id}@oauth.local`;
  return {
    user: { id: payload.user.id, email },
    session: {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token,
      user: { id: payload.user.id, email },
    },
  };
}

export class PasswordUpdatedWithoutSession extends Error {
  constructor() {
    super("Password updated without a usable email");
    this.name = "PasswordUpdatedWithoutSession";
  }
}

// Implicit recovery (no PKCE code challenge). The default Supabase email
// verifies on the Auth server and redirects with the session in the URL hash,
// which works when the link is opened on another device.
export async function requestPasswordRecovery(email: string, redirectTo: string): Promise<void> {
  const params = new URLSearchParams({ redirect_to: redirectTo });
  await supabaseJson(`/auth/v1/recover?${params.toString()}`, {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export async function readUserWithAccessToken(
  accessToken: string,
): Promise<{ id: string; email: string } | null> {
  const payload = await supabaseJson<{
    id?: string;
    email?: string;
    user?: { id?: string; email?: string };
  }>(
    "/auth/v1/user",
    { method: "GET" },
    accessToken,
  );
  const id = payload.id ?? payload.user?.id;
  const email = payload.email ?? payload.user?.email;
  if (!id || !email) return null;
  return { id, email };
}

export async function updatePasswordWithAccessToken(
  accessToken: string,
  password: string,
): Promise<{ id: string; email: string }> {
  const payload = await supabaseJson<{
    id?: string;
    email?: string;
    user?: { id?: string; email?: string };
  }>(
    "/auth/v1/user",
    {
      method: "PUT",
      body: JSON.stringify({ password }),
    },
    accessToken,
  );
  const id = payload.id ?? payload.user?.id;
  const email = payload.email ?? payload.user?.email;
  if (!id || !email) throw new PasswordUpdatedWithoutSession();
  return { id, email };
}

export async function signOut(session: Session | null): Promise<void> {
  if (!session) return;
  await supabaseRequest("/auth/v1/logout", { method: "POST" }, session.accessToken);
}

export async function requireSession(
  request: Request,
  response: Response,
): Promise<Session | null> {
  const session = await authenticate(request, response);
  if (!session) {
    response.status(401).json({ error: "로그인이 필요합니다." });
    return null;
  }
  return session;
}