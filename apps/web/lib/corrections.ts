/**
 * POST /api/corrections, step 1 (verify) + store. Scoring steps run after storage (see score.ts).
 */
import { and, eq } from "drizzle-orm";
import { verifyEvent, tagValue } from "@sats/nostr";
import type { Db } from "@sats/payouts";
import { clips, corrections } from "./db/schema";
import { CorrectionContent, KIND_CORRECTION } from "./protocol";
import { ensureWorker } from "./assign";

/** Offline queue (Phase 5) sends corrections late; replay defence is the UNIQUE event_id, not this window. */
export const MAX_AGE_SEC = 6 * 3600;
export const MAX_SKEW_SEC = 5 * 60;

export type VerifyError =
  | "INVALID_EVENT"
  | "WRONG_KIND"
  | "STALE"
  | "FUTURE"
  | "INVALID_CONTENT"
  | "CLIP_MISMATCH"
  | "UNKNOWN_CLIP"
  | "CLIP_CLOSED"
  | "REPLAY"
  | "ALREADY_DONE";

export type StoredCorrection = { id: string; clipId: string; pubkey: string; text: string; eventId: string };

/** Pure checks on the event (no DB). */
export function verifyCorrectionEvent(
  e: unknown,
  nowSec: number,
): { ok: true; pubkey: string; eventId: string; sig: string; clipId: string; text: string } | { ok: false; code: VerifyError } {
  if (!verifyEvent(e)) return { ok: false, code: "INVALID_EVENT" };
  if (e.kind !== KIND_CORRECTION) return { ok: false, code: "WRONG_KIND" };
  if (e.created_at < nowSec - MAX_AGE_SEC) return { ok: false, code: "STALE" };
  if (e.created_at > nowSec + MAX_SKEW_SEC) return { ok: false, code: "FUTURE" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(e.content);
  } catch {
    return { ok: false, code: "INVALID_CONTENT" };
  }
  const c = CorrectionContent.safeParse(parsed);
  if (!c.success) return { ok: false, code: "INVALID_CONTENT" };
  // The clip tag must match the content so relays/indexers see the same clip we score.
  if (tagValue(e, "clip") !== c.data.clip_id) return { ok: false, code: "CLIP_MISMATCH" };
  return { ok: true, pubkey: e.pubkey, eventId: e.id, sig: e.sig, clipId: c.data.clip_id, text: c.data.text };
}

/** Verify, then store as `pending`. Returns the stored row or a code. */
export async function storeCorrection(
  db: Db,
  e: unknown,
  nowSec = Math.floor(Date.now() / 1000),
): Promise<{ ok: true; correction: StoredCorrection } | { ok: false; code: VerifyError }> {
  const v = verifyCorrectionEvent(e, nowSec);
  if (!v.ok) return v;

  const [clip] = await db.select({ status: clips.status }).from(clips).where(eq(clips.id, v.clipId));
  if (!clip) return { ok: false, code: "UNKNOWN_CLIP" };
  if (clip.status !== "open") return { ok: false, code: "CLIP_CLOSED" };
  await ensureWorker(db, v.pubkey);

  const inserted = await db
    .insert(corrections)
    .values({ clipId: v.clipId, workerPubkey: v.pubkey, text: v.text, eventId: v.eventId, sig: v.sig })
    .onConflictDoNothing()
    .returning({ id: corrections.id });
  if (inserted.length === 0) {
    const [same] = await db.select({ id: corrections.id }).from(corrections).where(eq(corrections.eventId, v.eventId));
    if (same) return { ok: false, code: "REPLAY" };
    const [dup] = await db
      .select({ id: corrections.id })
      .from(corrections)
      .where(and(eq(corrections.clipId, v.clipId), eq(corrections.workerPubkey, v.pubkey)));
    if (dup) return { ok: false, code: "ALREADY_DONE" };
    return { ok: false, code: "REPLAY" };
  }
  return { ok: true, correction: { id: inserted[0]!.id, clipId: v.clipId, pubkey: v.pubkey, text: v.text, eventId: v.eventId } };
}
