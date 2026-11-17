import { after } from "next/server";
import { z } from "zod";
import { serverEnv } from "@sats/core/env";
import { log } from "@sats/core/log";
import { publishBestEffort } from "@sats/nostr";
import { getDb } from "@/lib/db";
import { resolveDisputed } from "@/lib/score";
import { ClipId } from "@/lib/protocol";
import { requireAdmin } from "@/lib/adminRoute";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

const Body = z.object({ clip_id: ClipId, correction_id: z.uuid() });

/** Sponsor picks the correct text for a disputed clip. */
export async function POST(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const b = Body.safeParse(await req.json().catch(() => null));
  if (!b.success) return json({ ok: false, code: "BAD_BODY" }, 400);
  const env = serverEnv();
  const r = await resolveDisputed(getDb(), { clipId: b.data.clip_id, correctionId: b.data.correction_id, serverNsec: env.SERVER_NOSTR_NSEC });
  if (!r.ok) return json(r, 400);
  log.info("sponsor.resolved", { id: b.data.clip_id });
  const ev = r.attestation;
  if (ev && env.NOSTR_RELAYS.length) after(() => publishBestEffort(ev, env.NOSTR_RELAYS).then(() => undefined));
  return json({ ok: true, attestationId: ev?.id });
}
