import { createHash, randomBytes } from "node:crypto";
import { Router, type Request, type Response } from "express";
import {
  authenticate,
  clearSessionCookie,
  exchangeOAuthCode,
  PasswordUpdatedWithoutSession,
  readSession,
  requestPasswordRecovery,
  requireSession,
  setSessionCookie,
  readUserWithAccessToken,
  signInWithAuth,
  signOut,
  updatePasswordWithAccessToken,
} from "../lib/session";
import {
  passwordPolicyMessage,
  validateNewPassword,
} from "@workspace/password-policy";
import { consentsForSession, readConsentFlags, recordOwnConsents } from "../lib/consents";
import { getProfile, type ProfileRow } from "../lib/data";
import { withDisplayPhoto } from "../lib/profile-photo-storage";

const router = Router();
const OAUTH_COOKIE_MAX_AGE = 10 * 60 * 1000;
type OAuthProvider = "kakao" | "google";

function oauthCookieName(provider: OAuthProvider, kind: "state" | "verifier"): string {
  return `swetin_${provider}_oauth_${kind}`;
}

// Path=/ so the verifier is sent on the top-level return from the provider
// even when an edge rewrite would not match the narrower /api/auth/{provider} path.
const OAUTH_COOKIE_PATHS = ["/", "/api/auth/kakao", "/api/auth/google"] as const;

function supabaseUrl(): string {
  const value = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  if (!value) throw new Error("SUPABASE_URL is required for OAuth.");
  return value;
}

function oauthProviderLabel(provider: OAuthProvider): string {
  return provider === "google" ? "Google" : "카카오";
}

function requestOrigin(request: Request): string {
  const protocol = request.header("x-forwarded-proto")?.split(",")[0]?.trim() || request.protocol;
  const host = request.header("x-forwarded-host")?.split(",")[0]?.trim() || request.get("host");
  if (!host) throw new Error("OAuth callback host is unavailable.");
  return `${protocol}://${host}`;
}

function oauthCookieOptions() {
  return {
    signed: true,
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    maxAge: OAUTH_COOKIE_MAX_AGE,
    path: "/",
  };
}

function clearOAuthCookies(response: Response, provider: OAuthProvider): void {
  const base = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
  };
  for (const path of OAUTH_COOKIE_PATHS) {
    response.clearCookie(oauthCookieName(provider, "state"), { ...base, path });
    response.clearCookie(oauthCookieName(provider, "verifier"), { ...base, path });
  }
}

function oauthErrorMessage(provider: OAuthProvider, value: unknown): string {
  const error = typeof value === "string" ? value : "";
  if (error === "access_denied" || error === "user_cancelled") {
    return `${oauthProviderLabel(provider)} 로그인을 취소했어요.`;
  }
  return `${oauthProviderLabel(provider)} 로그인에 실패했어요. 잠시 후 다시 시도해 주세요.`;
}

function redirectOAuthError(
  request: Request,
  response: Response,
  message: string,
  provider: OAuthProvider,
): void {
  clearOAuthCookies(response, provider);
  response.redirect(`${requestOrigin(request)}/login?oauth_error=${encodeURIComponent(message)}`);
}

function queryValue(value: unknown): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 2048) return null;
  return trimmed;
}

function oauthVerifier(request: Request, provider: OAuthProvider): string | null {
  const value = request.signedCookies?.[oauthCookieName(provider, "verifier")];
  if (typeof value !== "string" || value.length < 32 || value.length > 128) return null;
  return value;
}

const WRONG_PASSWORD = "이메일 또는 비밀번호를 확인해 주세요.";
const LOGIN_COOKIE_ERROR = "로그인 세션을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.";
const SIGNUP_COOKIE_ERROR = "회원가입 세션을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.";
// A signup that still needs email confirmation answers with this placeholder id
// so a new address and an already registered one get the same response.
const PENDING_SIGNUP_ID = "00000000-0000-0000-0000-000000000000";
const LOGIN_UNAVAILABLE = "로그인에 실패했습니다. 잠시 후 다시 시도해 주세요.";
const RESET_SENT = "메일을 확인해 주세요. 가입된 주소라면 재설정 링크가 도착해요.";
const RESET_EMAIL_INVALID = "이메일 주소를 확인해 주세요.";
const RESET_UNAVAILABLE = "재설정 메일을 보내지 못했어요. 잠시 후 다시 시도해 주세요.";
const RESET_LINK_INVALID = "재설정 링크가 만료됐거나 올바르지 않아요. 로그인 화면에서 다시 요청해 주세요.";
const RESET_PASSWORD_INVALID = passwordPolicyMessage("too_short");
const RESET_PASSWORD_SAME = "지금 쓰는 비밀번호와 다른 비밀번호로 정해 주세요.";
const RESET_PASSWORD_WEAK = "더 안전한 비밀번호로 정해 주세요.";
const RESET_FAILED = "비밀번호를 바꾸지 못했어요. 잠시 후 다시 시도해 주세요.";
const RESET_LOGIN_FOLLOWUP = "비밀번호를 바꿨어요. 새 비밀번호로 로그인해 주세요.";
const RESET_DONE = "비밀번호를 바꿨어요.";
const RECOVERY_TOKEN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const EXPIRED_RESET_CODES = new Set([
  "bad_jwt",
  "session_not_found",
  "session_expired",
  "otp_expired",
  "flow_state_expired",
  "refresh_token_not_found",
  "reauthentication_needed",
  "reauthentication_not_valid",
]);

function providerFailure(error: unknown): { status?: number; code?: string; message?: string } {
  const provider = error as {
    status?: unknown;
    payload?: { error_code?: unknown; msg?: unknown; message?: unknown; error?: unknown };
  };
  return {
    status: typeof provider.status === "number" ? provider.status : undefined,
    code: typeof provider.payload?.error_code === "string" ? provider.payload.error_code : undefined,
    message: [provider.payload?.msg, provider.payload?.message, provider.payload?.error]
      .find((value): value is string => typeof value === "string")
      ?.slice(0, 200),
  };
}

function authError(error: unknown, fallback: string): { status: number; message: string } {
  const message = error instanceof Error ? error.message : "";
  if (providerFailure(error).status === 429 || /\b429\b/.test(message)) {
    return { status: 429, message: "가입 요청이 많아요. 잠시 후 다시 시도해 주세요." };
  }
  return { status: 400, message: fallback };
}

function isRejectedCredential(error: unknown): boolean {
  const status = providerFailure(error).status;
  return status === 400 || status === 401;
}

async function displayedProfile(profile: ProfileRow | null): Promise<ProfileRow | null> {
  return profile ? withDisplayPhoto(profile) : null;
}

async function profileAfterAuth(
  request: Request,
  userId: string,
  accessToken: string,
): Promise<ProfileRow | null> {
  try {
    return displayedProfile(await getProfile(userId, accessToken));
  } catch (error) {
    request.log.error({ err: error, ...providerFailure(error) }, "Profile lookup failed after auth");
    return null;
  }
}

function sendSession(
  response: Response,
  status: number,
  user: { id: string; email: string },
  profile: ProfileRow | null,
  consentsCurrent: boolean,
): void {
  response.status(status).json({ user, profile, consents_current: consentsCurrent });
}

function recoveryEmail(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const value = (body as Record<string, unknown>).email;
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

function recoveryAccessToken(value: unknown): string | null {
  if (typeof value !== "string" || value.length < 20 || value.length > 8192 || !RECOVERY_TOKEN.test(value)) return null;
  return value;
}

function resetFailure(failure: { status?: number; code?: string; message?: string }): { status: number; message: string } {
  const code = failure.code ?? "";
  const detail = (failure.message ?? "").toLowerCase();
  if (
    failure.status === 401 ||
    failure.status === 403 ||
    EXPIRED_RESET_CODES.has(code) ||
    detail.includes("token is expired") ||
    detail.includes("invalid token") ||
    detail.includes("jwt")
  ) {
    return { status: 401, message: RESET_LINK_INVALID };
  }
  if (code === "same_password" || detail.includes("different from the old")) {
    return { status: 400, message: RESET_PASSWORD_SAME };
  }
  if (code === "weak_password" || detail.includes("weak password") || detail.includes("pwned")) {
    return { status: 400, message: RESET_PASSWORD_WEAK };
  }
  if (failure.status === 400 || failure.status === 422) {
    return { status: 400, message: RESET_FAILED };
  }
  return { status: 500, message: RESET_FAILED };
}

function credentials(body: unknown, minimumPasswordLength = 8): { email: string; password: string } | null {
  if (!body || typeof body !== "object") return null;
  const value = body as Record<string, unknown>;
  if (
    typeof value.email !== "string" ||
    typeof value.password !== "string" ||
    value.password.length < minimumPasswordLength ||
    value.password.length > 200
  ) {
    return null;
  }
  return { email: value.email.trim().toLowerCase(), password: value.password };
}

function newPasswordError(password: string, email?: string): string | null {
  const result = validateNewPassword(password, { email });
  return result.ok ? null : passwordPolicyMessage(result.reason);
}

async function sessionResponse(
  session: Awaited<ReturnType<typeof signInWithAuth>>["session"],
  user: { id: string; email: string },
) {
  return {
    user,
    profile: await displayedProfile(session ? await getProfile(user.id, session.accessToken) : null),
    consents_current: session ? await consentsForSession(session.accessToken) : false,
  };
}

function startOAuth(provider: OAuthProvider) {
  return (request: Request, response: Response): void => {
    try {
      const codeVerifier = randomBytes(32).toString("base64url");
      const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
      const callbackUrl = `${requestOrigin(request)}/api/auth/${provider}/callback`;

      // Supabase Auth owns the OAuth state parameter and redirects back with
      // only ?code=. A state cookie cannot be checked against that query.
      // The httpOnly verifier cookie is what binds the code to this browser.
      response.cookie(oauthCookieName(provider, "verifier"), codeVerifier, oauthCookieOptions());

      const authorizeUrl = new URL(`${supabaseUrl()}/auth/v1/authorize`);
      authorizeUrl.searchParams.set("provider", provider);
      authorizeUrl.searchParams.set("redirect_to", callbackUrl);
      authorizeUrl.searchParams.set("flow_type", "pkce");
      authorizeUrl.searchParams.set("code_challenge", codeChallenge);
      authorizeUrl.searchParams.set("code_challenge_method", "S256");
      // Do not set scopes. Supabase's Kakao provider always appends its own
      // list (see kakao-consent.ts) and a value here cannot remove account_email.
      response.redirect(authorizeUrl.toString());
    } catch {
      response.status(503).json({
        error: `${oauthProviderLabel(provider)} 로그인을 준비하지 못했어요. 잠시 후 다시 시도해 주세요.`,
      });
    }
  };
}

function completeOAuth(provider: OAuthProvider) {
  return async (request: Request, response: Response): Promise<void> => {
    const code = queryValue(request.query.code);
    const error = queryValue(request.query.error);
    if (error) {
      redirectOAuthError(request, response, oauthErrorMessage(provider, error), provider);
      return;
    }

    const codeVerifier = oauthVerifier(request, provider);
    if (!code || !codeVerifier) {
      redirectOAuthError(
        request,
        response,
        `${oauthProviderLabel(provider)} 로그인 확인 정보가 만료됐어요. 다시 시도해 주세요.`,
        provider,
      );
      return;
    }

    try {
      const result = await exchangeOAuthCode(code, codeVerifier);
      setSessionCookie(response, result.session);
      clearOAuthCookies(response, provider);
      const profile = await profileAfterAuth(request, result.user.id, result.session.accessToken);
      response.redirect(`${requestOrigin(request)}${profile ? "/home" : "/profile"}`);
    } catch {
      redirectOAuthError(
        request,
        response,
        oauthErrorMessage(provider, "oauth_error"),
        provider,
      );
    }
  };
}

router.get("/auth/kakao/start", startOAuth("kakao"));
router.get("/auth/kakao/callback", completeOAuth("kakao"));
router.get("/auth/google/start", startOAuth("google"));
router.get("/auth/google/callback", completeOAuth("google"));

router.post("/auth/signup", async (request, response) => {
  const input = credentials(request.body, 1);
  if (!input) {
    response.status(400).json({ error: "이메일과 비밀번호를 입력해 주세요." });
    return;
  }
  const passwordError = newPasswordError(input.password, input.email);
  if (passwordError) {
    response.status(400).json({ error: passwordError });
    return;
  }

  let result: Awaited<ReturnType<typeof signInWithAuth>>;
  try {
    result = await signInWithAuth(input.email, input.password, "signup");
  } catch (error) {
    request.log.warn({ err: error, ...providerFailure(error) }, "Email signup failed");
    const failure = authError(error, "회원가입에 실패했습니다. 입력한 정보를 확인해 주세요.");
    response.status(failure.status).json({ error: failure.message });
    return;
  }

  if (result.session) {
    try {
      setSessionCookie(response, result.session);
    } catch (error) {
      request.log.error({ err: error }, "Session cookie failed");
      response.status(500).json({ error: SIGNUP_COOKIE_ERROR });
      return;
    }
  }

  if (!result.session) {
    sendSession(response, 201, { id: PENDING_SIGNUP_ID, email: input.email }, null, false);
    return;
  }

  const flags = readConsentFlags(request.body);
  if (flags) {
    try {
      await recordOwnConsents(result.session.accessToken, flags);
    } catch (error) {
      request.log.error({ err: error }, "Signup consent record failed");
    }
  }

  const profile = await profileAfterAuth(request, result.user.id, result.session.accessToken);
  sendSession(
    response,
    201,
    result.user,
    profile,
    await consentsForSession(result.session.accessToken),
  );
});

router.post("/auth/login", async (request, response) => {
  const input = credentials(request.body);
  if (!input) {
    response.status(400).json({ error: "이메일과 비밀번호를 입력해 주세요." });
    return;
  }

  let result: Awaited<ReturnType<typeof signInWithAuth>>;
  try {
    result = await signInWithAuth(input.email, input.password, "login");
  } catch (error) {
    const provider = providerFailure(error);
    request.log.warn({ err: error, ...provider }, "Email login failed");
    if (isRejectedCredential(error)) {
      response.status(401).json({ error: WRONG_PASSWORD });
      return;
    }
    if (provider.status === 429) {
      response.status(429).json({ error: "로그인 요청이 많아요. 잠시 후 다시 시도해 주세요." });
      return;
    }
    response.status(500).json({ error: LOGIN_UNAVAILABLE });
    return;
  }

  if (!result.session) {
    request.log.error("Email login returned no session");
    response.status(401).json({ error: "로그인 세션을 만들지 못했습니다." });
    return;
  }

  try {
    setSessionCookie(response, result.session);
  } catch (error) {
    request.log.error({ err: error }, "Session cookie failed");
    response.status(500).json({ error: LOGIN_COOKIE_ERROR });
    return;
  }

  sendSession(
    response,
    200,
    result.user,
    await profileAfterAuth(request, result.user.id, result.session.accessToken),
    await consentsForSession(result.session.accessToken),
  );
});

router.post("/auth/recover", async (request, response) => {
  const email = recoveryEmail(request.body);
  if (!email) {
    response.status(400).json({ error: RESET_EMAIL_INVALID });
    return;
  }

  let redirectTo: string;
  try {
    redirectTo = `${requestOrigin(request)}/reset-password`;
  } catch (error) {
    request.log.error({ err: error }, "Password recovery redirect is unavailable");
    response.status(500).json({ error: RESET_UNAVAILABLE });
    return;
  }

  try {
    await requestPasswordRecovery(email, redirectTo);
  } catch (error) {
    const failure = providerFailure(error);
    request.log.warn({ err: error, ...failure }, "Password recovery request failed");
    // Unknown addresses already return 200 from Auth. Rate limits and send
    // failures only happen for registered addresses, so they use this same
    // response and do not reveal whether the address exists.
    if (!failure.status) {
      response.status(500).json({ error: RESET_UNAVAILABLE });
      return;
    }
  }

  response.status(200).json({ message: RESET_SENT });
});

router.post("/auth/reset-password", async (request, response) => {
  const body = request.body as Record<string, unknown> | null;
  const password = body && typeof body === "object" ? body.password : undefined;
  const accessToken = body && typeof body === "object" ? recoveryAccessToken(body.access_token) : null;
  if (typeof password !== "string" || password.length > 200) {
    response.status(400).json({ error: RESET_PASSWORD_INVALID });
    return;
  }
  const earlyPasswordError = newPasswordError(password);
  if (earlyPasswordError) {
    response.status(400).json({ error: earlyPasswordError });
    return;
  }
  if (!accessToken) {
    response.status(401).json({ error: RESET_LINK_INVALID });
    return;
  }

  let user: { id: string; email: string };
  try {
    const recovered = await readUserWithAccessToken(accessToken);
    const emailError = recovered ? newPasswordError(password, recovered.email) : null;
    if (emailError) {
      response.status(400).json({ error: emailError });
      return;
    }
    user = await updatePasswordWithAccessToken(accessToken, password);
  } catch (error) {
    if (error instanceof PasswordUpdatedWithoutSession) {
      request.log.warn({ err: error }, "Password reset did not return an email");
      response.status(200).json({ message: RESET_LOGIN_FOLLOWUP, session: null });
      return;
    }
    const failure = providerFailure(error);
    request.log.warn({ err: error, status: failure.status, code: failure.code }, "Password reset failed");
    const mapped = resetFailure(failure);
    response.status(mapped.status).json({ error: mapped.message });
    return;
  }

  let result: Awaited<ReturnType<typeof signInWithAuth>>;
  try {
    result = await signInWithAuth(user.email, password, "login");
  } catch (error) {
    request.log.warn({ err: error, ...providerFailure(error) }, "Sign-in after password reset failed");
    response.status(200).json({ message: RESET_LOGIN_FOLLOWUP, session: null });
    return;
  }
  if (!result.session) {
    response.status(200).json({ message: RESET_LOGIN_FOLLOWUP, session: null });
    return;
  }

  try {
    setSessionCookie(response, result.session);
  } catch (error) {
    request.log.error({ err: error }, "Session cookie failed after password reset");
    response.status(200).json({ message: RESET_LOGIN_FOLLOWUP, session: null });
    return;
  }

  response.status(200).json({
    message: RESET_DONE,
    session: {
      user: result.user,
      profile: await profileAfterAuth(request, result.user.id, result.session.accessToken),
      consents_current: await consentsForSession(result.session.accessToken),
    },
  });
});

router.post("/auth/logout", async (request, response) => {
  try {
    await signOut(readSession(request));
  } finally {
    clearSessionCookie(response);
    response.status(204).end();
  }
});

router.get("/auth/me", async (request, response) => {
  const session = await authenticate(request, response);
  if (!session) {
    response.status(401).json({ error: "로그인이 필요합니다." });
    return;
  }
  response.json(await sessionResponse(session, session.user));
});

export default router;