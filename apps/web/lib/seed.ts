/**
 * Seed loader: seed/manifest.json + seed/clips/<lang>/<id>.ogg (+ optional seed/drafts.json) → clips.
 * Idempotent: upserts by id; never touches status/consensus of clips already in the DB.
 */
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { parseBuffer } from "music-metadata";
import { z } from "zod";
import type { Db } from "@sats/payouts";
import { clips } from "./db/schema";
import { ClipId, Lang } from "./protocol";
import { priceSats } from "./pricing";

export const ManifestEntry = z
  .object({
    id: ClipId,
    lang: Lang,
    file: z.string().regex(/^clips\/(wo|yo|pcm|ha)\/[a-z0-9_-]{1,64}\.(ogg|opus|webm|mp3|m4a)$/),
    truth_text: z.string().min(1).max(500),
    is_gold: z.boolean(),
  })
  .strict();
export const Manifest = z.array(ManifestEntry);

export const DraftEntry = z.object({ text: z.string().max(500), model: z.string().max(80), confidence: z.number().min(0).max(1).nullable() });
export const Drafts = z.record(ClipId, DraftEntry);

const MIME: Record<string, string> = { ogg: "audio/ogg", opus: "audio/ogg", webm: "audio/webm", mp3: "audio/mpeg", m4a: "audio/mp4" };
export const MAX_CLIP_MS = 15_000;
export const MAX_CLIP_BYTES = 200_000;

export async function durationMs(buf: Uint8Array, mime: string): Promise<number> {
  const meta = await parseBuffer(buf, { mimeType: mime, size: buf.length }, { duration: true });
  const sec = meta.format.duration;
  if (!sec || !Number.isFinite(sec) || sec <= 0) throw new Error("could not read audio duration");
  return Math.round(sec * 1000);
}

export async function seedClips(db: Db, seedDir: string): Promise<{ loaded: number; skipped: string[] }> {
  const manifestPath = path.join(seedDir, "manifest.json");
  if (!existsSync(manifestPath)) return { loaded: 0, skipped: ["(no seed/manifest.json)"] };
  const manifest = Manifest.parse(JSON.parse(await readFile(manifestPath, "utf8")));
  const draftsPath = path.join(seedDir, "drafts.json");
  const drafts = existsSync(draftsPath) ? Drafts.parse(JSON.parse(await readFile(draftsPath, "utf8"))) : {};

  let loaded = 0;
  const skipped: string[] = [];
  for (const m of manifest) {
    const file = path.join(seedDir, m.file);
    if (!existsSync(file)) {
      skipped.push(`${m.id}: missing ${m.file}`);
      continue;
    }
    const audio = new Uint8Array(await readFile(file));
    const mime = MIME[m.file.split(".").pop()!]!;
    if (audio.length > MAX_CLIP_BYTES) {
      skipped.push(`${m.id}: larger than ${MAX_CLIP_BYTES} bytes`);
      continue;
    }
    const ms = await durationMs(audio, mime);
    if (ms > MAX_CLIP_MS) {
      skipped.push(`${m.id}: longer than 15 s`);
      continue;
    }
    const d = drafts[m.id];
    const values = {
      lang: m.lang,
      durationMs: ms,
      audio,
      audioMime: mime,
      truthText: m.truth_text,
      isGold: m.is_gold,
      draftText: d?.text ?? "",
      draftModel: d?.model ?? null,
      draftConfidence: d?.confidence ?? null,
      priceSats: priceSats({ durationMs: ms, draftConfidence: d?.confidence ?? null }),
    };
    await db
      .insert(clips)
      .values({ id: m.id, ...values })
      .onConflictDoUpdate({ target: clips.id, set: values });
    loaded++;
  }
  return { loaded, skipped };
}
