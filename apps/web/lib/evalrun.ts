/**
 * Eval + simulation runners (used by `pnpm eval`, `pnpm simulate` and tests). Runs the REAL scoring
 * pipeline on an in-memory Postgres (PGlite) with the synthetic data from evaldata.ts.
 */
import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { claimableSats, type Db } from "@sats/payouts";
import { signWithKey, pubkeyOf } from "@sats/nostr";
import { clips as clipsT, workers } from "./db/schema";
import { deterministicChecks, isCopyOf } from "./checks";
import { mockJudge } from "./judge";
import { judgeHardFlag, scoreCorrection, type Judge } from "./score";
import { storeCorrection } from "./corrections";
import { nextClip } from "./assign";
import { priceSats } from "./pricing";
import { cer, wer } from "./text";
import { KIND_CORRECTION } from "./protocol";
import { makeTestDb } from "./testDb";
import { GIBBERISH, INJECTIONS, honestText, rng, type EvalClip, type FraudCase } from "./evaldata";

// ---- fraud detection (per submission, before consensus) ---------------------------------------

export type Prf = { tp: number; fp: number; fn: number; tn: number; precision: number; recall: number };
const prf = (rows: Array<{ bad: boolean; flagged: boolean }>): Prf => {
  const tp = rows.filter((r) => r.bad && r.flagged).length;
  const fp = rows.filter((r) => !r.bad && r.flagged).length;
  const fn = rows.filter((r) => r.bad && !r.flagged).length;
  const tn = rows.length - tp - fp - fn;
  return { tp, fp, fn, tn, precision: tp + fp ? tp / (tp + fp) : 1, recall: tp + fn ? tp / (tp + fn) : 1 };
};

export async function fraudEval(clips: EvalClip[], cases: FraudCase[], judge: Judge = mockJudge) {
  const byId = new Map(clips.map((c) => [c.id, c]));
  const rows: Array<{ kind: string; bad: boolean; det: boolean; withJudge: boolean; ms: number }> = [];
  for (const k of cases) {
    const c = byId.get(k.clip_id)!;
    const checks = deterministicChecks({ text: k.text, draft: c.draft, durationMs: c.durationMs });
    // Other clips' texts count as finished consensus for the copy check.
    const others = clips.filter((o) => o.id !== c.id).map((o) => o.truth);
    const det = checks.hard.length > 0 || isCopyOf(k.text, others);
    const t0 = performance.now();
    const v = det ? null : await judge({ text: k.text, lang: c.lang });
    const ms = performance.now() - t0;
    const withJudge = det || (v != null && judgeHardFlag(v, c.lang) != null);
    rows.push({ kind: k.kind, bad: k.label === "bad", det, withJudge, ms });
  }
  const kinds = [...new Set(rows.map((r) => r.kind))];
  return {
    deterministic: prf(rows.map((r) => ({ bad: r.bad, flagged: r.det }))),
    withJudge: prf(rows.map((r) => ({ bad: r.bad, flagged: r.withJudge }))),
    byKind: kinds.map((kind) => {
      const rs = rows.filter((r) => r.kind === kind);
      return { kind, n: rs.length, bad: rs[0]!.bad, det: rs.filter((r) => r.det).length, withJudge: rs.filter((r) => r.withJudge).length };
    }),
    judgeMs: percentiles(rows.filter((r) => !r.det).map((r) => r.ms)),
  };
}

export function percentiles(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  const p = (q: number) => (s.length ? s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)]! : 0);
  return { n: s.length, p50: p(0.5), p95: p(0.95) };
}

// ---- end-to-end simulation ----------------------------------------------------------------------

export type WorkerType = "honest" | "lazy" | "malicious";
export type SimOpts = { workers: number; honest: number; lazy: number; malicious: number; seed?: number; judge?: Judge | null };

async function loadClips(db: Db, clips: EvalClip[]) {
  for (const c of clips) {
    await db.insert(clipsT).values({
      id: c.id,
      lang: c.lang,
      durationMs: c.durationMs,
      audio: new Uint8Array([0]),
      truthText: c.truth,
      isGold: c.gold,
      draftText: c.draft,
      draftConfidence: 0.5,
      priceSats: priceSats({ durationMs: c.durationMs, draftConfidence: 0.5 }),
    });
  }
}

function maliciousText(c: EvalClip, all: EvalClip[], r: () => number): string {
  const x = r();
  if (x < 0.25) return INJECTIONS[Math.floor(r() * INJECTIONS.length)]!;
  if (x < 0.45) return GIBBERISH[Math.floor(r() * GIBBERISH.length)]!;
  if (x < 0.65) {
    const other = all.filter((o) => o.lang === c.lang && o.id !== c.id);
    return other[Math.floor(r() * other.length)]!.truth; // another clip's text
  }
  // Plausible-looking but wrong: real words of the language, shuffled from other clips.
  const words = all.filter((o) => o.lang === c.lang && o.id !== c.id).flatMap((o) => o.truth.split(" "));
  const n = c.truth.split(" ").length;
  return Array.from({ length: n }, () => words[Math.floor(r() * words.length)]!).join(" ");
}

export async function simulate(clips: EvalClip[], o: SimOpts) {
  const { db, close } = await makeTestDb();
  try {
    const r = rng(o.seed ?? 42);
    await db.execute(sql`select setseed(0.42)`);
    await loadClips(db, clips);
    const langs = [...new Set(clips.map((c) => c.lang))];
    const nH = Math.round(o.workers * o.honest);
    const nL = Math.round(o.workers * o.lazy);
    const types: WorkerType[] = Array.from({ length: o.workers }, (_, i) => (i < nH ? "honest" : i < nH + nL ? "lazy" : "malicious"));
    const ws = types.map((type, i) => {
      const sk = randomBytes(32);
      return { type, sk: Uint8Array.from(sk), pubkey: pubkeyOf(sk.toString("hex")), lang: langs[i % langs.length]!, done: false };
    });
    const byId = new Map(clips.map((c) => [c.id, c]));
    const judge = o.judge === null ? undefined : (o.judge ?? mockJudge);
    const scoreMs: number[] = [];

    for (let round = 0; round < 40 && ws.some((w) => !w.done); round++) {
      const order = [...ws].sort(() => r() - 0.5);
      for (const w of order) {
        if (w.done) continue;
        const task = await nextClip(db, { pubkey: w.pubkey, lang: w.lang, random: r });
        if (!task) {
          w.done = true;
          continue;
        }
        const c = byId.get(task.id)!;
        const text = w.type === "honest" ? honestText(c.truth, r) : w.type === "lazy" ? c.draft : maliciousText(c, clips, r);
        const ev = signWithKey({ kind: KIND_CORRECTION, content: JSON.stringify({ clip_id: c.id, text }), tags: [["clip", c.id]] }, w.sk);
        const s = await storeCorrection(db, ev);
        if (!s.ok) continue;
        const t0 = performance.now();
        await scoreCorrection(db, s.correction, { judge });
        scoreMs.push(performance.now() - t0);
      }
    }

    const earned: Record<WorkerType, { workers: number; sats: number }> = {
      honest: { workers: 0, sats: 0 },
      lazy: { workers: 0, sats: 0 },
      malicious: { workers: 0, sats: 0 },
    };
    for (const w of ws) {
      earned[w.type].workers++;
      earned[w.type].sats += await claimableSats(db, w.pubkey);
    }
    const total = earned.honest.sats + earned.lazy.sats + earned.malicious.sats;
    // "Leaked" = sats paid for a transcript that is actually wrong (CER > 0.15 vs the hidden truth),
    // whoever submitted it. A lazy worker pasting a draft that happens to be right isn't a leak.
    const paid = (await db.execute(
      sql`select r.sats, c.text, k.truth_text from rewards r join corrections c on c.id::text = r.source_id join clips k on k.id = c.clip_id`,
    )) as unknown as { rows: Array<{ sats: number; text: string; truth_text: string }> };
    const wrongPaid = paid.rows.filter((p) => cer(p.truth_text, p.text, { diacritics: false }) > 0.15);
    const leakedSats = wrongPaid.reduce((a, p) => a + p.sats, 0);
    const rows = await db.select().from(clipsT);
    const perLang = langs.map((lang) => {
      const ng = rows.filter((c) => c.lang === lang && !c.isGold);
      const done = ng.filter((c) => c.status === "done");
      const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
      return {
        lang,
        clips: ng.length,
        done: done.length,
        disputed: ng.filter((c) => c.status === "disputed").length,
        draftWer: avg(ng.map((c) => wer(c.truthText!, c.draftText, { diacritics: false }))),
        draftCer: avg(ng.map((c) => cer(c.truthText!, c.draftText, { diacritics: false }))),
        consensusWer: avg(done.map((c) => wer(c.truthText!, c.consensusText!, { diacritics: false }))),
        consensusCer: avg(done.map((c) => cer(c.truthText!, c.consensusText!, { diacritics: false }))),
      };
    });
    const accepted = Number(
      ((await db.execute(sql`select count(*)::int as n from corrections where decision = 'accepted'`)) as unknown as { rows: Array<{ n: number }> })
        .rows[0]!.n,
    );
    const qualified = (await db.select().from(workers)).filter((w) => w.goldAttempts > 0 && w.goldCorrect / w.goldAttempts >= 0.7).length;
    return {
      earned,
      totalSats: total,
      nonHonestSats: earned.lazy.sats + earned.malicious.sats,
      leakedSats,
      leakedPct: total ? leakedSats / total : 0,
      wrongPaidCount: wrongPaid.length,
      perLang,
      accepted,
      qualified,
      satsPerDoneClip: (() => {
        const done = perLang.reduce((s, l) => s + l.done, 0);
        const nonGoldSats = paid.rows.filter((p) => rows.some((c) => c.truthText === p.truth_text && !c.isGold)).reduce((a, p) => a + p.sats, 0);
        return done ? nonGoldSats / done : 0;
      })(),
      goldSats: paid.rows.filter((p) => rows.some((c) => c.truthText === p.truth_text && c.isGold)).reduce((a, p) => a + p.sats, 0),
      scoreMs: percentiles(scoreMs),
    };
  } finally {
    await close();
  }
}

// ---- red team: 10 attacks through the full pipeline ------------------------------------------------

export async function redTeam(clips: EvalClip[]) {
  const { db, close } = await makeTestDb();
  const results: Array<{ case: string; expected: string; actual: string; pass: boolean }> = [];
  try {
    await loadClips(db, clips);
    const mk = () => {
      const sk = randomBytes(32);
      return { sk: Uint8Array.from(sk), pubkey: pubkeyOf(sk.toString("hex")) };
    };
    const sign = (w: { sk: Uint8Array }, clipId: string, text: string) =>
      signWithKey({ kind: KIND_CORRECTION, content: JSON.stringify({ clip_id: clipId, text }), tags: [["clip", clipId]] }, w.sk);
    const run = async (w: { sk: Uint8Array }, clipId: string, text: string) => {
      const s = await storeCorrection(db, sign(w, clipId, text));
      if (!s.ok) return s.code;
      const out = await scoreCorrection(db, s.correction, { judge: mockJudge });
      return out.decision === "accepted" ? `accepted, ${out.sats} sats${out.code ? ` (${out.code})` : ""}` : `${out.decision}${out.code ? ` (${out.code})` : ""}`;
    };
    const golds = clips.filter((c) => c.gold && c.lang === "wo");
    const qualify = async (w: { sk: Uint8Array }) => {
      for (const g of golds) await run(w, g.id, g.truth);
    };
    const nonGold = clips.filter((c) => !c.gold);
    let next = 0;
    const firstDone = nonGold[0]!;
    /** A fresh clip with 2 honest qualified submissions already in (the attacker is 3rd). */
    const primed = async () => {
      const c = nonGold[next++]!;
      for (let i = 0; i < 2; i++) {
        const h = mk();
        await qualify(h);
        await run(h, c.id, c.truth);
      }
      return c;
    };
    const attacker = mk();
    await qualify(attacker);
    const add = (name: string, expected: string, actual: string) => results.push({ case: name, expected, actual, pass: actual.startsWith(expected) });

    let c = await primed();
    add("Honest correction as 3rd speaker", "accepted", await run(attacker, c.id, c.truth.toLowerCase()));
    // Use a clip whose draft is clearly wrong (a right draft pasted back is a right answer).
    const wrongDraftIdx = nonGold.findIndex((x, i) => i >= next && cer(x.truth, x.draft, { diacritics: false }) > 0.3);
    if (wrongDraftIdx > next) [nonGold[next], nonGold[wrongDraftIdx]] = [nonGold[wrongDraftIdx]!, nonGold[next]!];
    c = await primed();
    add("Lazy paste-back of a wrong AI draft", "rejected (disagree)", await run(attacker, c.id, c.draft));
    c = await primed();
    add("Prompt injection in the transcript", "rejected (injection)", await run(attacker, c.id, INJECTIONS[0]!));
    c = await primed();
    add("Keyboard-mash gibberish", "rejected (gibberish)", await run(attacker, c.id, "asdf qwer zxcv asdf qwer zxcv"));
    c = await primed();
    add("Correct-looking French instead of the clip language", "rejected (wrong_language)", await run(attacker, c.id, "Bonjour, comment allez vous aujourd'hui?"));
    const doneClip = firstDone; // finished in case 1
    c = await primed();
    add("Another clip's consensus text", "rejected (copy_other_clip)", await run(attacker, c.id, doneClip.truth));
    c = await primed();
    const ev = sign(attacker, c.id, c.truth);
    await storeCorrection(db, ev);
    add("Replay the same signed event", "REPLAY", ((await storeCorrection(db, ev)) as { code?: string }).code ?? "stored");
    const forged = { ...sign(attacker, c.id, "x"), content: JSON.stringify({ clip_id: c.id, text: c.truth }) };
    add("Forged signature (edited content)", "INVALID_EVENT", ((await storeCorrection(db, forged)) as { code?: string }).code ?? "stored");
    add("Second answer on the same clip", "ALREADY_DONE", ((await storeCorrection(db, sign(attacker, c.id, c.truth + " x"))) as { code?: string }).code ?? "stored");
    const unq = mk();
    for (const g of golds) await run(unq, g.id, "maa ngi fi rekk sama xarit");
    c = await primed();
    add("Worker who failed gold qualification answers honestly", "accepted, 0 sats (low_gold_accuracy)", await run(unq, c.id, c.truth));
    return results;
  } finally {
    await close();
  }
}

