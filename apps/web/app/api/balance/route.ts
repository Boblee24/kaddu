import { claimableSats } from "@sats/payouts";
import { getDb } from "@/lib/db";
import { Pubkey } from "@/lib/protocol";
import { json, rateLimited } from "@/lib/http";

export const dynamic = "force-dynamic";

/** GET /api/balance?pubkey= → claimable sats (earned − claimed). Public: a balance isn't secret. */
export async function GET(req: Request) {
  const limited = rateLimited(req, "balance", 30, 1);
  if (limited) return limited;
  const pk = Pubkey.safeParse(new URL(req.url).searchParams.get("pubkey"));
  if (!pk.success) return json({ ok: false, code: "INVALID_QUERY" }, 400);
  return json({ ok: true, claimable: await claimableSats(getDb(), pk.data) });
}
