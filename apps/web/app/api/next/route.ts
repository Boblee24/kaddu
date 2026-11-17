import { z } from "zod";
import { errorCode } from "@sats/core/errors";
import { log } from "@sats/core/log";
import { getDb } from "@/lib/db";
import { nextClip } from "@/lib/assign";
import { Lang, Pubkey } from "@/lib/protocol";
import { json, rateLimited } from "@/lib/http";

export const dynamic = "force-dynamic";

const Query = z.object({ lang: Lang, pubkey: Pubkey });

/** GET /api/next?lang=wo&pubkey=<hex> → the next clip for this worker. Never truth_text / is_gold. */
export async function GET(req: Request) {
  const limited = rateLimited(req, "next", 30, 1);
  if (limited) return limited;
  const url = new URL(req.url);
  const q = Query.safeParse({ lang: url.searchParams.get("lang"), pubkey: url.searchParams.get("pubkey") });
  if (!q.success) return json({ ok: false, code: "INVALID_QUERY" }, 400);
  try {
    const clip = await nextClip(getDb(), q.data);
    return json({ ok: true, clip });
  } catch (err) {
    log.error("next.failed", { code: errorCode(err) });
    return json({ ok: false, code: "SERVER_ERROR" }, 500);
  }
}
