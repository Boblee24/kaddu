import { after } from "next/server";
import { serverEnv } from "@sats/core/env";
import { errorCode } from "@sats/core/errors";
import { publishBestEffort } from "@sats/nostr";
import { scoreCorrection } from "@/lib/score";
import { getJudge } from "@/lib/judge";
import { log } from "@sats/core/log";
import { getDb } from "@/lib/db";
import { storeCorrection } from "@/lib/corrections";
import { json, rateLimited } from "@/lib/http";

export const dynamic = "force-dynamic";

const MAX_BODY = 4096;

/** POST /api/corrections { event } — a Nostr event signed by the worker's key. */
export async function POST(req: Request) {
  const limited = rateLimited(req, "corrections", 20, 0.5);
  if (limited) return limited;
  const raw = await req.text();
  if (raw.length > MAX_BODY) return json({ ok: false, code: "TOO_LARGE" }, 413);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ ok: false, code: "INVALID_JSON" }, 400);
  }
  const event = body && typeof body === "object" ? (body as { event?: unknown }).event : undefined;
  try {
    const r = await storeCorrection(getDb(), event);
    if (!r.ok) {
      log.info("correction.rejected", { code: r.code });
      return json({ ok: false, code: r.code }, r.code === "REPLAY" || r.code === "ALREADY_DONE" ? 409 : 400);
    }
    const env = serverEnv();
    const out = await scoreCorrection(getDb(), r.correction, { serverNsec: env.SERVER_NOSTR_NSEC, judge: getJudge() });
    log.info("correction.scored", { id: r.correction.id, status: out.decision, code: out.code ?? "none", count: out.sats });
    const attestation = out.attestation;
    if (attestation && env.NOSTR_RELAYS.length > 0) {
      // Best-effort, after the response: a slow relay must never delay the worker's result.
      after(async () => {
        const p = await publishBestEffort(attestation, env.NOSTR_RELAYS);
        log.info("attestation.published", { id: attestation.id, count: p.ok.length });
      });
    }
    return json({
      ok: true,
      correctionId: r.correction.id,
      decision: out.decision,
      code: out.code,
      sats: out.sats,
      consensus: out.consensus,
      attestationId: attestation?.id,
    });
  } catch (err) {
    log.error("correction.failed", { code: errorCode(err) });
    return json({ ok: false, code: "SERVER_ERROR" }, 500);
  }
}
