/** Public scoreboard numbers (no pubkeys, no transcripts). Cached 60 s per server instance. */
import { eq, sql } from "drizzle-orm";
import { claims, rewards, type Db } from "@sats/payouts";
import { clips, corrections } from "./db/schema";
import { LANGS } from "./db/langs";
import { wer } from "./text";

export type LangStats = {
  lang: (typeof LANGS)[number];
  clips: number;
  done: number;
  /** AI draft vs the workers' consensus: how much the crowd had to fix. */
  draftWer: number | null;
  /** Consensus vs the known transcript, on clips that have one: how good the crowd is. */
  consensusWer: number | null;
};
export type Scoreboard = { langs: LangStats[]; satsPaid: number; satsEarned: number; contributors: number; at: number };

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export async function computeScoreboard(db: Db): Promise<Scoreboard> {
  const rows = await db
    .select({ lang: clips.lang, status: clips.status, draft: clips.draftText, consensus: clips.consensusText, truth: clips.truthText, gold: clips.isGold })
    .from(clips);
  const langs = LANGS.map((lang) => {
    const mine = rows.filter((r) => r.lang === lang && !r.gold);
    const done = mine.filter((r) => r.status === "done" && r.consensus);
    return {
      lang,
      clips: mine.length,
      done: done.length,
      draftWer: avg(done.filter((r) => r.draft).map((r) => wer(r.consensus!, r.draft, { diacritics: false }))),
      consensusWer: avg(done.filter((r) => r.truth).map((r) => wer(r.truth!, r.consensus!, { diacritics: false }))),
    };
  }).filter((l) => l.clips > 0);
  const [paid] = await db.select({ s: sql<number>`coalesce(sum(${claims.sats}),0)::int` }).from(claims).where(eq(claims.status, "paid"));
  const [earned] = await db.select({ s: sql<number>`coalesce(sum(${rewards.sats}),0)::int` }).from(rewards);
  const [people] = await db
    .select({ n: sql<number>`count(distinct ${corrections.workerPubkey})::int` })
    .from(corrections)
    .where(eq(corrections.decision, "accepted"));
  return { langs, satsPaid: Number(paid?.s ?? 0), satsEarned: Number(earned?.s ?? 0), contributors: Number(people?.n ?? 0), at: Date.now() };
}

let cache: Scoreboard | null = null;
export async function scoreboard(db: Db, ttlMs = 60_000): Promise<Scoreboard> {
  if (cache && Date.now() - cache.at < ttlMs) return cache;
  cache = await computeScoreboard(db);
  return cache;
}
