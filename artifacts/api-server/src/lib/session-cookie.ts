import type { NextFunction, Request, RequestHandler, Response } from "express";
import cookieParser from "cookie-parser";
import { logger } from "./logger";

type CookieMap = Record<string, string>;

/**
 * Vercel's Node runtime defines `req.cookies` before the handler runs.
 * cookie-parser 1.4 treats any truthy `req.cookies` as already parsed and
 * returns without setting `req.secret` or `req.signedCookies`. Express then
 * throws from `res.cookie({ signed: true })` before it appends Set-Cookie.
 */
export function sessionCookieParser(secret: string): RequestHandler {
  const parse = cookieParser(secret);
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.secret) {
      // delete does not invoke a lazy getter, so the platform value is discarded
      // and cookie-parser can install the signing secret itself.
      Reflect.deleteProperty(req, "cookies");
    }
    parse(req, res, (error?: unknown) => {
      if (!req.secret) {
        req.secret = secret;
        try {
          if (req.cookies) restoreSignedCookies(req, secret);
        } catch (restoreError) {
          logger.warn({ err: restoreError }, "Signed cookie restore failed");
        }
      }
      if (error) next(error);
      else next();
    });
  };
}

function stringCookies(value: unknown): CookieMap {
  if (!value || typeof value !== "object") return {};
  const cookies: CookieMap = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string") cookies[key] = entry;
  }
  return cookies;
}

function restoreSignedCookies(req: Request, secret: string): void {
  const parsed = stringCookies(req.cookies);
  const signed = cookieParser.signedCookies(parsed, secret);
  const signedStrings = Object.fromEntries(
    Object.entries(signed).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  // Leave platform `req.cookies` in place. It may be a non-configurable getter,
  // and session reads use `req.signedCookies`.
  req.signedCookies = cookieParser.JSONCookies(signedStrings);
}
