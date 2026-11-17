import { errorCode } from "@sats/core/errors";
import { log } from "@sats/core/log";
import { claim } from "@sats/payouts";
import { getDb } from "@/lib/db";
import { verifyClaimEvent } from "@/lib/claim";
import { getSponsor } from "@/lib/sponsor";
import { isPaused } from "@/lib/sponsorOps";
import { json, rateLimited } from "@/lib/http";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BODY = 4096;

/** POST /api/claim { event } — event.content is the worker's bolt11, signed by the worker's key. */
export async function POST(req: Request) {
  const limited = rateLimited(req, "claim", 5, 0.1);
  if (limited) return limited;
  const raw = await req.text();
  if (raw.length > MAX_BODY) return json({ status: "rejected", code: "TOO_LARGE" }, 413);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ status: "rejected", code: "INVALID_JSON" }, 400);
  }
  const v = verifyClaimEvent((body as { event?: unknown } | null)?.event, Math.floor(Date.now() / 1000));
  if (!v.ok) return json({ status: "rejected", code: v.code }, 400);
  try {
    if (await isPaused(getDb())) return json({ status: "rejected", code: "PAUSED" }, 503);
    const { wallet, limits } = await getSponsor();
    const r = await claim(getDb(), wallet, { pubkey: v.pubkey, bolt11: v.bolt11, limits });
    if (r.status === "rejected") log.info("claim.rejected", { code: r.code });
    else log.info("claim.done", { status: r.status, paymentHash: r.paymentHash, count: r.sats });
    return json(r, r.status === "rejected" ? 400 : 200);
  } catch (err) {
    log.error("claim.failed", { code: errorCode(err) });
    return json({ status: "rejected", code: "SERVER_ERROR" }, 500);
  }
}
