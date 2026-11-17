import { serverEnv } from "@sats/core/env";
import { errorCode } from "@sats/core/errors";
import { log } from "@sats/core/log";
import { getDb } from "@/lib/db";
import { overview } from "@/lib/sponsorOps";
import { getSponsor } from "@/lib/sponsor";
import { requireAdmin } from "@/lib/adminRoute";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const env = serverEnv();
  const o = await overview(getDb());
  let budget: { usedSats: number; totalSats: number; renewsAt?: number } | null = null;
  let wallet: "ok" | "missing" | "error" = env.SPONSOR_NWC_URL ? "ok" : "missing";
  if (env.SPONSOR_NWC_URL) {
    try {
      budget = await (await getSponsor()).wallet.budget();
    } catch (err) {
      wallet = "error";
      log.warn("sponsor.budget_failed", { code: errorCode(err) });
    }
  }
  return json({ ok: true, ...o, dailyCap: env.MAX_DAILY_PAYOUT_SATS, budget, wallet });
}
