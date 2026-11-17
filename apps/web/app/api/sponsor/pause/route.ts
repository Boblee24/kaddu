import { z } from "zod";
import { log } from "@sats/core/log";
import { getDb } from "@/lib/db";
import { setPaused } from "@/lib/sponsorOps";
import { requireAdmin } from "@/lib/adminRoute";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const b = z.object({ paused: z.boolean() }).safeParse(await req.json().catch(() => null));
  if (!b.success) return json({ ok: false, code: "BAD_BODY" }, 400);
  await setPaused(getDb(), b.data.paused);
  log.info("sponsor.pause", { status: b.data.paused ? "paused" : "resumed" });
  return json({ ok: true, paused: b.data.paused });
}
