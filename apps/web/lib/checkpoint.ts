/**
 * Helpers for scripts/checkpoint.ts (a test harness for the live-worker flow, not used by the app).
 * Kept here so the script needs no dependencies of its own.
 */
import { and, eq, sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { pubkeyOf, secretKeyFrom, signWithKey, type EventInput } from "@sats/nostr";
import type { Db } from "@sats/payouts";
import { clips, corrections } from "./db/schema";
import type { LANGS } from "./db/langs";

type Lang = (typeof LANGS)[number];

export function newWorker() {
  const hex = randomBytes(32).toString("hex");
  const sk = secretKeyFrom(hex);
  return { pubkey: pubkeyOf(hex), sign: (e: EventInput) => signWithKey(e, sk) };
}

export async function goldClips(db: Db, lang: Lang, n: number) {
  return db
    .select({ id: clips.id, truth: clips.truthText })
    .from(clips)
    .where(and(eq(clips.lang, lang), eq(clips.isGold, true)))
    .orderBy(sql`random()`)
    .limit(n);
}

/** An open non-gold clip with exactly 2 pending corrections, neither a paste-back of the draft. */
export async function primedClip(db: Db, lang: Lang): Promise<{ id: string; truth: string } | null> {
  const pending = sql<number>`(select count(*) from ${corrections} k where k.clip_id = ${clips.id} and k.decision = 'pending')`;
  const lazy = sql`exists (select 1 from ${corrections} k where k.clip_id = ${clips.id} and k.unchanged)`;
  const rows = await db
    .select({ id: clips.id, truth: clips.truthText })
    .from(clips)
    .where(and(eq(clips.lang, lang), eq(clips.isGold, false), eq(clips.status, "open"), sql`${clips.truthText} is not null`, sql`${pending} = 2`, sql`not ${lazy}`))
    .orderBy(sql`random()`)
    .limit(1);
  const r = rows[0];
  return r?.truth ? { id: r.id, truth: r.truth } : null;
}
