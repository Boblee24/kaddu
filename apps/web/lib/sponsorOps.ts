/** Sponsor console operations (server only; every route that calls these checks the admin cookie). */
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { claims, spendToday, type Db } from "@sats/payouts";
import { attestations, clips, corrections, settings } from "./db/schema";
import { ClipId, Lang } from "./protocol";
import { priceSats } from "./pricing";
import { durationMs, MAX_CLIP_BYTES, MAX_CLIP_MS } from "./seed";
import { LICENSE } from "./score";

// ---- pause switch -------------------------------------------------------------------------------

export async function isPaused(db: Db): Promise<boolean> {
  const [r] = await db.select({ v: settings.value }).from(settings).where(eq(settings.key, "payouts_paused"));
  return r?.v === "1";
}

export async function setPaused(db: Db, paused: boolean): Promise<void> {
  await db
    .insert(settings)
    .values({ key: "payouts_paused", value: paused ? "1" : "0" })
    .onConflictDoUpdate({ target: settings.key, set: { value: paused ? "1" : "0", updatedAt: new Date() } });
}

// ---- overview -----------------------------------------------------------------------------------

export async function overview(db: Db) {
  const byStatus = await db
    .select({ lang: clips.lang, status: clips.status, n: sql<number>`count(*)::int` })
    .from(clips)
    .groupBy(clips.lang, clips.status);
  const [paidTotal] = await db
    .select({ sats: sql<number>`coalesce(sum(${claims.sats}), 0)::int` })
    .from(claims)
    .where(eq(claims.status, "paid"));
  return { byStatus, spentToday: await spendToday(db), paidTotal: Number(paidTotal?.sats ?? 0), paused: await isPaused(db) };
}

// ---- disputed review ----------------------------------------------------------------------------

export async function disputedClips(db: Db, limit = 20) {
  const rows = await db
    .select({ id: clips.id, lang: clips.lang, draft: clips.draftText, durationMs: clips.durationMs })
    .from(clips)
    .where(eq(clips.status, "disputed"))
    .orderBy(clips.createdAt)
    .limit(limit);
  const out = [];
  for (const r of rows) {
    const cs = await db
      .select({ id: corrections.id, text: corrections.text })
      .from(corrections)
      .where(and(eq(corrections.clipId, r.id), eq(corrections.decision, "pending")));
    out.push({ ...r, corrections: cs });
  }
  return out;
}

// ---- upload -------------------------------------------------------------------------------------

export const UPLOAD_MIME = ["audio/ogg", "audio/webm", "audio/mpeg", "audio/mp4"] as const;
export const UploadFields = z.object({
  id: ClipId,
  lang: Lang,
  truth_text: z.string().trim().max(500).optional().transform((v) => (v ? v : undefined)),
  is_gold: z.enum(["0", "1"]).default("0"),
});

export type UploadError = "BAD_FIELDS" | "BAD_MIME" | "TOO_LARGE" | "TOO_LONG" | "BAD_AUDIO" | "GOLD_NEEDS_TRUTH" | "DUPLICATE_ID";

export async function uploadClip(
  db: Db,
  o: { fields: Record<string, unknown>; mime: string; bytes: Uint8Array },
): Promise<{ ok: true; id: string; durationMs: number; priceSats: number } | { ok: false; code: UploadError }> {
  const f = UploadFields.safeParse(o.fields);
  if (!f.success) return { ok: false, code: "BAD_FIELDS" };
  const mime = o.mime.split(";")[0]!.trim().toLowerCase();
  if (!(UPLOAD_MIME as readonly string[]).includes(mime)) return { ok: false, code: "BAD_MIME" };
  if (o.bytes.length === 0 || o.bytes.length > MAX_CLIP_BYTES) return { ok: false, code: "TOO_LARGE" };
  let ms: number;
  try {
    ms = await durationMs(o.bytes, mime);
  } catch {
    return { ok: false, code: "BAD_AUDIO" };
  }
  if (ms > MAX_CLIP_MS) return { ok: false, code: "TOO_LONG" };
  const gold = f.data.is_gold === "1";
  if (gold && !f.data.truth_text) return { ok: false, code: "GOLD_NEEDS_TRUTH" };
  const price = priceSats({ durationMs: ms, draftConfidence: null });
  const inserted = await db
    .insert(clips)
    .values({ id: f.data.id, lang: f.data.lang, durationMs: ms, audio: o.bytes, audioMime: mime, truthText: f.data.truth_text ?? null, isGold: gold, priceSats: price })
    .onConflictDoNothing()
    .returning({ id: clips.id });
  if (inserted.length === 0) return { ok: false, code: "DUPLICATE_ID" };
  return { ok: true, id: f.data.id, durationMs: ms, priceSats: price };
}

// ---- export -------------------------------------------------------------------------------------

/** One JSON object per finished clip. Contributors are pubkeys (pseudonymous); no audio, no truth_text. */
export async function exportJsonl(db: Db): Promise<string> {
  const done = await db
    .select({ id: clips.id, lang: clips.lang, text: clips.consensusText, eventId: attestations.eventId })
    .from(clips)
    .leftJoin(attestations, eq(attestations.clipId, clips.id))
    .where(eq(clips.status, "done"))
    .orderBy(desc(clips.createdAt));
  const lines: string[] = [];
  for (const d of done) {
    const who = await db
      .select({ pk: corrections.workerPubkey })
      .from(corrections)
      .where(and(eq(corrections.clipId, d.id), eq(corrections.decision, "accepted")));
    lines.push(
      JSON.stringify({
        clip_id: d.id,
        lang: d.lang,
        consensus_text: d.text,
        contributors: who.map((w) => w.pk).sort(),
        attestation_event_id: d.eventId ?? null,
        license: LICENSE,
      }),
    );
  }
  return lines.join("\n") + (lines.length ? "\n" : "");
}
