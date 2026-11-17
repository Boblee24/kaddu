/**
 * Scripted personas for the demo (clearly simulated; see README "What's simulated").
 * Each persona first passes qualification on gold clips, then 2 personas pre-submit on every open
 * non-gold clip, so the live worker's submission is the 3rd and consensus forms instantly.
 *   persona1: the truth
 *   persona2: the truth with 1–2 typos
 *   persona3: a lazy paste-back of the AI draft (used on every 3rd clip instead of persona2)
 */
import { and, eq } from "drizzle-orm";
import { signWithKey, secretKeyFrom } from "@sats/nostr";
import type { Db } from "@sats/payouts";
import { clips } from "./db/schema";
import { KIND_CORRECTION } from "./protocol";
import { storeCorrection } from "./corrections";
import { scoreCorrection, type ScoreOpts } from "./score";

/** Deterministic 1–2 character typos (drop a letter, swap two neighbours). */
export function typo(text: string, seed: number): string {
  const chars = Array.from(text);
  const letters = chars.map((c, i) => (/\p{L}/u.test(c) ? i : -1)).filter((i) => i >= 0);
  if (letters.length < 6) return text;
  const a = letters[seed % letters.length]!;
  chars.splice(a, 1);
  if (seed % 2 === 0 && chars.length > 3) {
    const b = Math.min(chars.length - 2, Math.floor(chars.length / 2));
    [chars[b], chars[b + 1]] = [chars[b + 1]!, chars[b]!];
  }
  return chars.join("");
}

type Persona = { name: string; sk: Uint8Array };

async function submitAs(db: Db, p: Persona, clipId: string, text: string, opts: ScoreOpts) {
  const ev = signWithKey({ kind: KIND_CORRECTION, content: JSON.stringify({ clip_id: clipId, text }), tags: [["clip", clipId]] }, p.sk);
  const s = await storeCorrection(db, ev);
  if (!s.ok) return s.code; // ALREADY_DONE on re-runs: idempotent
  return (await scoreCorrection(db, s.correction, opts)).decision;
}

export async function runPersonas(db: Db, nsecs: [string, string, string], opts: ScoreOpts = {}) {
  const [p1, p2, p3] = nsecs.map((n, i) => ({ name: `persona${i + 1}`, sk: secretKeyFrom(n) })) as [Persona, Persona, Persona];
  const all = await db
    .select({ id: clips.id, lang: clips.lang, isGold: clips.isGold, truth: clips.truthText, draft: clips.draftText })
    .from(clips)
    .orderBy(clips.id);
  const stats = { qualified: 0, presubmitted: 0, clips: 0 };

  // Qualification: each persona answers 2 gold clips per language correctly.
  for (const p of [p1, p2, p3]) {
    const perLang = new Map<string, number>();
    for (const c of all.filter((c) => c.isGold && c.truth)) {
      const n = perLang.get(c.lang) ?? 0;
      if (n >= 2) continue;
      perLang.set(c.lang, n + 1);
      await submitAs(db, p, c.id, c.truth!, opts);
      stats.qualified++;
    }
  }

  const open = await db
    .select({ id: clips.id, truth: clips.truthText, draft: clips.draftText })
    .from(clips)
    .where(and(eq(clips.isGold, false), eq(clips.status, "open")))
    .orderBy(clips.id);
  for (const [i, c] of open.entries()) {
    if (!c.truth) continue;
    stats.clips++;
    await submitAs(db, p1, c.id, c.truth, opts);
    const lazy = i % 3 === 2 && c.draft.trim().length > 0;
    await submitAs(db, lazy ? p3 : p2, c.id, lazy ? c.draft : typo(c.truth, i + 1), opts);
    stats.presubmitted += 2;
  }
  return stats;
}
