/**
 * Clip assignment for /api/next. Workers can't choose clips (collusion defence):
 *  - the first QUALIFY_GOLD clips any worker sees are gold (qualification);
 *  - after that, ~GOLD_MIX of clips are hidden gold, the rest random open non-gold clips;
 *  - never a clip the worker already did.
 * The returned task never contains truth_text or is_gold.
 */
import { and, eq, notExists, sql } from "drizzle-orm";
import type { Db } from "@sats/payouts";
import { clips, corrections, workers, type Lang } from "./db/schema";
import type { ClipTask } from "./protocol";

export const QUALIFY_GOLD = 2;
export const GOLD_MIX = 0.25;

export async function ensureWorker(db: Db, pubkey: string): Promise<void> {
  await db.insert(workers).values({ pubkey }).onConflictDoNothing({ target: workers.pubkey });
}

async function goldDone(db: Db, pubkey: string): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(corrections)
    .innerJoin(clips, eq(clips.id, corrections.clipId))
    .where(and(eq(corrections.workerPubkey, pubkey), eq(clips.isGold, true)));
  return Number(r?.n ?? 0);
}

async function pick(db: Db, o: { pubkey: string; lang: Lang; gold: boolean }) {
  const [row] = await db
    .select({ id: clips.id, lang: clips.lang, durationMs: clips.durationMs, draftText: clips.draftText, draftModel: clips.draftModel, priceSats: clips.priceSats })
    .from(clips)
    .where(
      and(
        eq(clips.lang, o.lang),
        eq(clips.isGold, o.gold),
        eq(clips.status, "open"),
        notExists(
          db
            .select({ one: sql`1` })
            .from(corrections)
            .where(and(eq(corrections.clipId, clips.id), eq(corrections.workerPubkey, o.pubkey))),
        ),
      ),
    )
    .orderBy(sql`random()`)
    .limit(1);
  return row;
}

export async function nextClip(db: Db, o: { pubkey: string; lang: Lang; random?: () => number }): Promise<ClipTask | null> {
  const rand = o.random ?? Math.random;
  await ensureWorker(db, o.pubkey);
  const qualifying = (await goldDone(db, o.pubkey)) < QUALIFY_GOLD;
  const wantGold = qualifying || rand() < GOLD_MIX;
  // Qualification needs gold; if none is left, fall through to regular clips (and vice versa).
  const row = (await pick(db, { ...o, gold: wantGold })) ?? (await pick(db, { ...o, gold: !wantGold }));
  if (!row) return null;
  const { draftModel, ...rest } = row;
  return { ...rest, draftSimulated: draftModel === "simulated", audioUrl: `/api/clips/${row.id}/audio` };
}
