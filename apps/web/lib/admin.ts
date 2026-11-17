/**
 * Sponsor console auth. The browser never stores ADMIN_TOKEN itself: after a constant-time check it
 * gets an httpOnly, SameSite=strict cookie holding HMAC(ADMIN_TOKEN, purpose), which rotates whenever
 * the token does.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { serverEnv } from "@sats/core/env";

export const ADMIN_COOKIE = "kaddu_admin";
const PURPOSE = "kaddu-admin-session-v1";

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  // Compare equal-length buffers so timing doesn't reveal the length either.
  const len = Math.max(x.length, y.length, 1);
  const xp = Buffer.alloc(len);
  const yp = Buffer.alloc(len);
  x.copy(xp);
  y.copy(yp);
  return timingSafeEqual(xp, yp) && x.length === y.length;
}

export function sessionValue(token: string): string {
  return createHmac("sha256", token).update(PURPOSE).digest("base64url");
}

/** True when the submitted token matches ADMIN_TOKEN. False if ADMIN_TOKEN isn't configured. */
export function checkToken(submitted: unknown, adminToken = serverEnv().ADMIN_TOKEN): boolean {
  if (!adminToken || typeof submitted !== "string" || submitted.length > 512) return false;
  return safeEqual(submitted, adminToken);
}

/** True when the request carries a valid admin session cookie. */
export function isAdmin(req: Request, adminToken = serverEnv().ADMIN_TOKEN): boolean {
  if (!adminToken) return false;
  const cookie = req.headers.get("cookie") ?? "";
  const m = new RegExp(`(?:^|;\\s*)${ADMIN_COOKIE}=([^;]+)`).exec(cookie);
  return m ? safeEqual(m[1]!, sessionValue(adminToken)) : false;
}

export function sessionCookie(adminToken: string, secure: boolean): string {
  return `${ADMIN_COOKIE}=${sessionValue(adminToken)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200${secure ? "; Secure" : ""}`;
}
