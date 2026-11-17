import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { setLogSink } from "@sats/core/log";
import type { Db } from "@sats/payouts";
import { nextClip, QUALIFY_GOLD } from "./assign";
import { storeCorrection, MAX_AGE_SEC } from "./corrections";
import { addClip, makeTestDb, makeWorker } from "./testDb";
import { priceSats } from "./pricing";

let db: Db;
let reset: () => Promise<void>;
let close: () => Promise<void>;
const restoreLog = setLogSink(() => {});
beforeAll(async () => ({ db, reset, close } = await makeTestDb()));
afterAll(async () => {
  restoreLog();
  await close();
});
beforeEach(async () => reset());

describe("pricing", () => {
  it("follows the table", () => {
    expect(priceSats({ durationMs: 4000, draftConfidence: 0.9 })).toBe(20);
    expect(priceSats({ durationMs: 4000, draftConfidence: 0.5 })).toBe(30);
    expect(priceSats({ durationMs: 7000, draftConfidence: 0.9 })).toBe(30);
    expect(priceSats({ durationMs: 7000, draftConfidence: 0.1 })).toBe(40);
    expect(priceSats({ durationMs: 6000, draftConfidence: 0.6 })).toBe(20);
    expect(priceSats({ durationMs: 4000, draftConfidence: null })).toBe(30);
  });
});

describe("nextClip", () => {
  it("serves gold first, never leaks truth or gold flag, then mixes", async () => {
    await addClip(db, { id: "g1", gold: true, truth: "secret one" });
    await addClip(db, { id: "g2", gold: true, truth: "secret two" });
    await addClip(db, { id: "g3", gold: true, truth: "secret three" });
    await addClip(db, { id: "n1" });
    const w = makeWorker();
    const seen: string[] = [];
    for (let i = 0; i < QUALIFY_GOLD; i++) {
      const t = await nextClip(db, { pubkey: w.pubkey, lang: "wo", random: () => 0.99 });
      expect(t).not.toBeNull();
      expect(Object.keys(t!).sort()).toEqual(["audioUrl", "draftText", "durationMs", "id", "lang", "priceSats"]);
      expect(JSON.stringify(t)).not.toContain("secret");
      expect(t!.id).toMatch(/^g/);
      const r = await storeCorrection(db, w.correct(t!.id, "x y"));
      expect(r.ok).toBe(true);
      seen.push(t!.id);
    }
    // Qualified: random >= GOLD_MIX picks a regular clip.
    const t = await nextClip(db, { pubkey: w.pubkey, lang: "wo", random: () => 0.99 });
    expect(t!.id).toBe("n1");
    expect(new Set(seen).size).toBe(QUALIFY_GOLD);
  });

  it("never repeats a clip, filters by language and status, returns null when exhausted", async () => {
    await addClip(db, { id: "a", lang: "yo" });
    await addClip(db, { id: "b", lang: "wo" });
    await addClip(db, { id: "c", lang: "yo" });
    await db.execute(sql`update clips set status = 'done' where id = 'c'`);
    const w = makeWorker();
    const t = await nextClip(db, { pubkey: w.pubkey, lang: "yo" });
    expect(t!.id).toBe("a"); // no gold exists, falls back to regular
    await storeCorrection(db, w.correct("a", "hi"));
    expect(await nextClip(db, { pubkey: w.pubkey, lang: "yo" })).toBeNull();
  });
});

describe("storeCorrection", () => {
  it("stores a valid correction as pending", async () => {
    await addClip(db, { id: "c1" });
    const w = makeWorker();
    const r = await storeCorrection(db, w.correct("c1", "Naka nga def"));
    expect(r.ok).toBe(true);
    const rows = await db.execute(sql`select decision, worker_pubkey from corrections`);
    expect(rows.rows ?? rows).toMatchObject([{ decision: "pending", worker_pubkey: w.pubkey }]);
  });

  it("rejects replay, double work, bad sig, bad kind, stale, future, bad content, mismatched tag, unknown/closed clip", async () => {
    await addClip(db, { id: "c1" });
    await addClip(db, { id: "c2" });
    await addClip(db, { id: "closed" });
    await db.execute(sql`update clips set status = 'done' where id = 'closed'`);
    const w = makeWorker();
    const now = Math.floor(Date.now() / 1000);
    const e = w.correct("c1", "text");
    expect((await storeCorrection(db, e)).ok).toBe(true);
    expect(await storeCorrection(db, e)).toEqual({ ok: false, code: "REPLAY" });
    expect(await storeCorrection(db, w.correct("c1", "other text"))).toEqual({ ok: false, code: "ALREADY_DONE" });
    expect(await storeCorrection(db, { ...w.correct("c2", "t"), content: JSON.stringify({ clip_id: "c2", text: "forged" }) })).toEqual({
      ok: false,
      code: "INVALID_EVENT",
    });
    expect(await storeCorrection(db, "garbage")).toEqual({ ok: false, code: "INVALID_EVENT" });
    expect(await storeCorrection(db, w.correct("c2", "t", { createdAt: now - MAX_AGE_SEC - 60 }))).toEqual({ ok: false, code: "STALE" });
    expect((await storeCorrection(db, w.correct("c2", "late but ok", { createdAt: now - 5 * 3600 }))).ok).toBe(true);
    const w2 = makeWorker();
    expect(await storeCorrection(db, w2.correct("c2", "t", { createdAt: now + 600 }))).toEqual({ ok: false, code: "FUTURE" });
    expect(await storeCorrection(db, w2.correct("c2", "x".repeat(501)))).toEqual({ ok: false, code: "INVALID_CONTENT" });
    expect(await storeCorrection(db, w2.correct("c2", "t", { tagClip: "c1" }))).toEqual({ ok: false, code: "CLIP_MISMATCH" });
    expect(await storeCorrection(db, w2.correct("nope", "t"))).toEqual({ ok: false, code: "UNKNOWN_CLIP" });
    expect(await storeCorrection(db, w2.correct("closed", "t"))).toEqual({ ok: false, code: "CLIP_CLOSED" });
  });
});
