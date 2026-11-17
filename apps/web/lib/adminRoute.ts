import { isAdmin } from "./admin";
import { json } from "./http";

/** 401 unless the request has a valid admin session. Use at the top of every /api/sponsor route. */
export function requireAdmin(req: Request) {
  return isAdmin(req) ? null : json({ ok: false, code: "UNAUTHORIZED" }, 401);
}
