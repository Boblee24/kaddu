/**
 * Scoring pipeline after a correction is stored (CLAUDE.md steps 2–7). All server-side.
 *   checks → (gold scoring | LLM judge → consensus) → payout eligibility → accrue → attestation
 * Amounts come only from clips.price_sats (the server price table). The judge has no say over money.
 */
import { createHash } from "node:crypto";
import { and, eq, ne, isNotNull, sql } from "drizzle-orm";
import { accrue, type Db } from "@sats/payouts";
import { serverSign, type NostrEvent } from "@sats/nostr";
import { attestations, clips, corrections, workers, type Decision, type Lang } from "./db/schema";
import { deterministicChecks, isCopyOf, type Checks } from "./checks";
import { findConsensus, K } from "./consensus";
import { cer } from "./text";
import { KIND_ATTESTATION } from "./protocol";
import type { StoredCorrection } from "./corrections";

export const GOLD_CER = 0.15;
export const MIN_GOLD_ACCURACY = 0.7;
export const DAILY_CAP = 50;
export const LICENSE = "CC-BY-4.0";

/** Judge verdict (Phase 3). Hard flags reject; nothing here can change an amount or recipient. */
export type JudgeVerdict = {
  plausible_language: Lang | "fr" | "en" | "other";
  gibberish: boolean;
  injection_text: boolean;
  offensive: boolean;
  note: string;
};
export type Judge = (o: { text: string; lang: Lang }) => Promise<JudgeVerdict | null>;

export function judgeHardFlag(v: JudgeVerdict, lang: Lang): string | null {
  if (v.injection_text) return "injection";
  if (v.gibberish) return "gibberish";
  const sameLang = v.plausible_language === lang || (lang === "pcm" && v.plausible_language === "en");
  if (!sameLang) return "wrong_language";
  return null;
}

export type ScoreOpts = { judge?: Judge; serverNsec?: string; now?: Date };

export type ScoreOutcome = {
  decision: Decision;
  code?: string;
  /** Sats accrued for THIS correction now (0 if not paid or not yet decided). */
  sats: number;
  /** True when this submission completed the clip's consensus. */
  consensus: boolean;
  /** Attestation to publish best-effort (outside the request's critical path). */
  attestation?: NostrEvent;
};

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const utcDay = (d: Date) => d.toISOString().slice(0, 10);

async function setDecision(db: Db | Tx, id: string, decision: Decision, rejectCode: string | null, extra: Partial<{ checks: Checks & Record<string, unknown>; judge: JudgeVerdict | null }> = {}) {
  await db
    .update(corrections)
    .set({ decision, rejectCode, ...extra })
    .where(eq(corrections.id, id));
}

/**
 * Pay an accepted correction if the worker is eligible: gold accuracy ≥ 0.7 and under the daily cap.
 * Returns the sats accrued (0 if ineligible). Idempotent via accrue's sourceId.
 */
export async function payIfEligible(tx: Tx, o: { correctionId: string; pubkey: string; sats: number; now: Date }): Promise<{ sats: number; reason?: string }> {
  const day = utcDay(o.now);
  const [w] = await tx.select().from(workers).where(eq(workers.pubkey, o.pubkey)).for("update");
  if (!w) return { sats: 0, reason: "no_worker" };
  const acc = w.goldAttempts > 0 ? w.goldCorrect / w.goldAttempts : 0;
  if (acc < MIN_GOLD_ACCURACY) return { sats: 0, reason: "low_gold_accuracy" };
  const today = w.day === day ? w.acceptedToday : 0;
  if (today >= DAILY_CAP) return { sats: 0, reason: "daily_cap" };
  await tx.update(workers).set({ day, acceptedToday: today + 1 }).where(eq(workers.pubkey, o.pubkey));
  await accrue(tx as unknown as Db, { pubkey: o.pubkey, sats: o.sats, sourceId: o.correctionId, reason: "correction" });
  return { sats: o.sats };
}

export function attestationEvent(o: { clipId: string; lang: Lang; consensusText: string; contributors: string[]; nsec: string; now: Date }): NostrEvent {
  const content = {
    lang: o.lang,
    consensus_sha256: createHash("sha256").update(o.consensusText.normalize("NFC")).digest("hex"),
    contributors: [...o.contributors].sort(),
    license: LICENSE,
  };
  return serverSign(
    { kind: KIND_ATTESTATION, content: JSON.stringify(content), tags: [["d", o.clipId], ["t", "kaddu"]], created_at: Math.floor(o.now.getTime() / 1000) },
    o.nsec,
  );
}

export async function scoreCorrection(db: Db, c: StoredCorrection, o: ScoreOpts = {}): Promise<ScoreOutcome> {
  const now = o.now ?? new Date();
  const [clip] = await db.select().from(clips).where(eq(clips.id, c.clipId));
  if (!clip) throw new Error("score: clip vanished");

  // Step 2: deterministic checks.
  const checks: Checks = deterministicChecks({ text: c.text, draft: clip.draftText, durationMs: clip.durationMs });
  const others = await db
    .select({ t: clips.consensusText })
    .from(clips)
    .where(and(ne(clips.id, clip.id), isNotNull(clips.consensusText)));
  if (isCopyOf(c.text, others.map((r) => r.t!))) {
    checks.copyOtherClip = true;
    checks.hard.push("copy_other_clip");
  }
  await db.update(corrections).set({ checks, unchanged: checks.unchanged }).where(eq(corrections.id, c.id));
  if (checks.hard.length > 0) {
    await setDecision(db, c.id, "rejected", checks.hard[0]!);
    return { decision: "rejected", code: checks.hard[0]!, sats: 0, consensus: false };
  }

  // Step 3: gold clips — score against the known transcript, pay right away if correct.
  if (clip.isGold) {
    const correct = clip.truthText != null && cer(clip.truthText, c.text, { diacritics: false }) <= GOLD_CER;
    return db.transaction(async (tx) => {
      await tx
        .update(workers)
        .set({
          goldAttempts: sql`${workers.goldAttempts} + 1`,
          goldCorrect: correct ? sql`${workers.goldCorrect} + 1` : workers.goldCorrect,
        })
        .where(eq(workers.pubkey, c.pubkey));
      if (!correct) {
        await setDecision(tx, c.id, "rejected", "gold_mismatch");
        return { decision: "rejected" as const, code: "gold_mismatch", sats: 0, consensus: false };
      }
      await setDecision(tx, c.id, "accepted", null);
      const paid = await payIfEligible(tx, { correctionId: c.id, pubkey: c.pubkey, sats: clip.priceSats, now });
      return { decision: "accepted" as const, code: paid.reason, sats: paid.sats, consensus: false };
    });
  }

  // Step 4: LLM judge (text-only, untrusted). A judge outage doesn't block: consensus still applies.
  if (o.judge) {
    const verdict = await o.judge({ text: c.text, lang: clip.lang }).catch(() => null);
    if (verdict) {
      const flag = judgeHardFlag(verdict, clip.lang);
      await db.update(corrections).set({ judge: verdict }).where(eq(corrections.id, c.id));
      if (flag) {
        await setDecision(db, c.id, "rejected", flag);
        return { decision: "rejected", code: flag, sats: 0, consensus: false };
      }
    }
  }

  // Steps 5–7 under a row lock on the clip, so two simultaneous 3rd submissions can't both resolve it.
  const result = await db.transaction(async (tx) => {
    const [locked] = await tx.select({ status: clips.status }).from(clips).where(eq(clips.id, clip.id)).for("update");
    if (locked?.status !== "open") return { decision: "pending" as const, sats: 0, consensus: false };
    const pending = await tx
      .select({ id: corrections.id, text: corrections.text, pubkey: corrections.workerPubkey })
      .from(corrections)
      .where(and(eq(corrections.clipId, clip.id), eq(corrections.decision, "pending")))
      .orderBy(corrections.createdAt);
    if (pending.length < K) return { decision: "pending" as const, sats: 0, consensus: false };

    const r = findConsensus(pending);
    if (r.kind === "disputed") {
      await tx.update(clips).set({ status: "disputed" }).where(eq(clips.id, clip.id));
      return { decision: "pending" as const, code: "disputed", sats: 0, consensus: false };
    }

    let mine: ScoreOutcome = { decision: "rejected", code: "disagree", sats: 0, consensus: true };
    const contributors: string[] = [];
    for (const p of pending) {
      if (r.accepted.includes(p.id)) {
        await setDecision(tx, p.id, "accepted", null);
        const paid = await payIfEligible(tx, { correctionId: p.id, pubkey: p.pubkey, sats: clip.priceSats, now });
        contributors.push(p.pubkey);
        if (p.id === c.id) mine = { decision: "accepted", code: paid.reason, sats: paid.sats, consensus: true };
      } else {
        await setDecision(tx, p.id, "rejected", "disagree");
      }
    }
    await tx.update(clips).set({ status: "done", consensusText: r.consensusText }).where(eq(clips.id, clip.id));

    if (o.serverNsec) {
      const ev = attestationEvent({ clipId: clip.id, lang: clip.lang, consensusText: r.consensusText, contributors, nsec: o.serverNsec, now });
      await tx
        .insert(attestations)
        .values({ clipId: clip.id, eventId: ev.id, event: ev as unknown as Record<string, unknown> })
        .onConflictDoNothing();
      mine.attestation = ev;
    }
    return mine;
  });
  return result;
}

/**
 * Sponsor review of a disputed clip: the chosen correction becomes the consensus. Its author is paid
 * (subject to the same eligibility rules); the others are rejected. Idempotent per clip.
 */
export async function resolveDisputed(
  db: Db,
  o: { clipId: string; correctionId: string; serverNsec?: string; now?: Date },
): Promise<{ ok: true; attestation?: NostrEvent } | { ok: false; code: "NOT_DISPUTED" | "UNKNOWN_CORRECTION" }> {
  const now = o.now ?? new Date();
  return db.transaction(async (tx) => {
    const [clip] = await tx.select().from(clips).where(eq(clips.id, o.clipId)).for("update");
    if (!clip || clip.status !== "disputed") return { ok: false as const, code: "NOT_DISPUTED" as const };
    const rows = await tx
      .select({ id: corrections.id, text: corrections.text, pubkey: corrections.workerPubkey })
      .from(corrections)
      .where(and(eq(corrections.clipId, clip.id), eq(corrections.decision, "pending")));
    const chosen = rows.find((r) => r.id === o.correctionId);
    if (!chosen) return { ok: false as const, code: "UNKNOWN_CORRECTION" as const };
    for (const r of rows) {
      if (r.id === chosen.id) {
        await setDecision(tx, r.id, "accepted", "sponsor_review");
        await payIfEligible(tx, { correctionId: r.id, pubkey: r.pubkey, sats: clip.priceSats, now });
      } else await setDecision(tx, r.id, "rejected", "disagree");
    }
    await tx.update(clips).set({ status: "done", consensusText: chosen.text }).where(eq(clips.id, clip.id));
    if (!o.serverNsec) return { ok: true as const };
    const ev = attestationEvent({ clipId: clip.id, lang: clip.lang, consensusText: chosen.text, contributors: [chosen.pubkey], nsec: o.serverNsec, now });
    await tx.insert(attestations).values({ clipId: clip.id, eventId: ev.id, event: ev as unknown as Record<string, unknown> }).onConflictDoNothing();
    return { ok: true as const, attestation: ev };
  });
}
