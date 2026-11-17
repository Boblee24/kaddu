import { serverEnv } from "@sats/core/env";
import { log } from "@sats/core/log";
import { checkToken, sessionCookie } from "@/lib/admin";
import { json, rateLimited } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const limited = rateLimited(req, "sponsor-login", 5, 0.05);
  if (limited) return limited;
  const body = (await req.json().catch(() => null)) as { token?: unknown } | null;
  const token = serverEnv().ADMIN_TOKEN;
  if (!token || !checkToken(body?.token, token)) {
    log.warn("sponsor.login_failed");
    return json({ ok: false, code: "UNAUTHORIZED" }, 401);
  }
  const res = json({ ok: true });
  res.headers.append("set-cookie", sessionCookie(token, new URL(req.url).protocol === "https:"));
  return res;
}
