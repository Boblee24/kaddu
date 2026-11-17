/** Test helpers: an in-memory PGlite database with the Kàddu schema. Not imported by app code. */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { pubkeyOf, signWithKey, type NostrEvent } from "@sats/nostr";
import type { Db } from "@sats/payouts";
import { migrate } from "./db/migrate";
import { clips, type Lang } from "./db/schema";
import { KIND_CORRECTION } from "./protocol";

export async function makeTestDb(): Promise<{ db: Db; reset: () => Promise<void>; close: () => Promise<void> }> {
  const pg = new PGlite();
  const db = drizzle(pg) as unknown as Db;
  await migrate(db);
  return {
    db,
    reset: async () => {
      await db.execute(sql`truncate rewards, claims, attestations, corrections, workers, clips cascade`);
    },
    close: () => pg.close(),
  };
}

export async function addClip(
  db: Db,
  o: { id: string; lang?: Lang; gold?: boolean; truth?: string; draft?: string; durationMs?: number; price?: number; conf?: number | null },
) {
  await db.insert(clips).values({
    id: o.id,
    lang: o.lang ?? "wo",
    durationMs: o.durationMs ?? 4000,
    audio: new Uint8Array([79, 103, 103, 83]),
    truthText: o.truth ?? null,
    isGold: o.gold ?? false,
    draftText: o.draft ?? "",
    draftConfidence: o.conf ?? null,
    priceSats: o.price ?? 30,
  });
}

export function makeWorker() {
  const hex = randomBytes(32).toString("hex");
  const sk = Uint8Array.from(Buffer.from(hex, "hex"));
  return {
    pubkey: pubkeyOf(hex),
    correct(clipId: string, text: string, o: { createdAt?: number; tagClip?: string } = {}): NostrEvent {
      return signWithKey(
        {
          kind: KIND_CORRECTION,
          content: JSON.stringify({ clip_id: clipId, text }),
          tags: [["clip", o.tagClip ?? clipId]],
          created_at: o.createdAt,
        },
        sk,
      );
    },
  };
}
