import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { setLogSink } from "@sats/core/log";
import { claimableSats, type Db } from "@sats/payouts";
import { checkToken, isAdmin, sessionCookie, sessionValue, ADMIN_COOKIE } from "./admin";
import { exportJsonl, isPaused, setPaused, uploadClip } from "./sponsorOps";
import { resolveDisputed, scoreCorrection } from "./score";
import { storeCorrection } from "./corrections";
import { computeScoreboard } from "./scoreboard";
import { addClip, makeTestDb, makeWorker } from "./testDb";
import { clips, workers } from "./db/schema";

const TOKEN = "t".repeat(32);

describe("admin auth", () => {
  it("checks the token in constant time and rejects anything else", () => {
    expect(checkToken(TOKEN, TOKEN)).toBe(true);
    expect(checkToken(TOKEN.slice(0, -1), TOKEN)).toBe(false);
    expect(checkToken(TOKEN + "x", TOKEN)).toBe(false);
    expect(checkToken(undefined, TOKEN)).toBe(false);
    expect(checkToken(TOKEN, undefined)).toBe(false);
  });

  it("cookie holds an HMAC, not the token, and is httpOnly + SameSite=Strict", () => {
    const c = sessionCookie(TOKEN, true);
    expect(c).not.toContain(TOKEN);
    expect(c).toMatch(/HttpOnly; SameSite=Strict/);
    expect(c).toContain("Secure");
    const req = (cookie: string) => new Request("https://x/api/sponsor/overview", { headers: { cookie } });
    expect(isAdmin(req(`${ADMIN_COOKIE}=${sessionValue(TOKEN)}`), TOKEN)).toBe(true);
    expect(isAdmin(req(`${ADMIN_COOKIE}=${sessionValue("other-token-xxxxxxxxxxxxxxxx")}`), TOKEN)).toBe(false);
    expect(isAdmin(req(`${ADMIN_COOKIE}=${TOKEN}`), TOKEN)).toBe(false);
    expect(isAdmin(req(""), TOKEN)).toBe(false);
    expect(isAdmin(req(`${ADMIN_COOKIE}=${sessionValue(TOKEN)}`), undefined)).toBe(false);
  });
});

describe("sponsor ops", () => {
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

  it("pause switch round-trips", async () => {
    expect(await isPaused(db)).toBe(false);
    await setPaused(db, true);
    expect(await isPaused(db)).toBe(true);
    await setPaused(db, false);
    expect(await isPaused(db)).toBe(false);
  });

  it("upload validates fields, MIME, size and audio", async () => {
    const ok = { id: "wo_100", lang: "wo", is_gold: "0" };
    const bytes = new Uint8Array([1, 2, 3]);
    expect(await uploadClip(db, { fields: { ...ok, lang: "xx" }, mime: "audio/ogg", bytes })).toEqual({ ok: false, code: "BAD_FIELDS" });
    expect(await uploadClip(db, { fields: { ...ok, id: "../etc" }, mime: "audio/ogg", bytes })).toEqual({ ok: false, code: "BAD_FIELDS" });
    expect(await uploadClip(db, { fields: ok, mime: "text/html", bytes })).toEqual({ ok: false, code: "BAD_MIME" });
    expect(await uploadClip(db, { fields: ok, mime: "audio/ogg", bytes: new Uint8Array(200_001) })).toEqual({ ok: false, code: "TOO_LARGE" });
    expect(await uploadClip(db, { fields: ok, mime: "audio/ogg", bytes })).toEqual({ ok: false, code: "BAD_AUDIO" });
  });

  it("resolves a disputed clip: chosen text wins, author paid, others rejected; export lists it", async () => {
    await addClip(db, { id: "g1", gold: true, truth: "naka nga def jerejef", price: 20 });
    await addClip(db, { id: "d1", price: 30 });
    const ws = [makeWorker(), makeWorker(), makeWorker()];
    for (const w of ws) {
      const s = await storeCorrection(db, w.correct("g1", "naka nga def jerejef"));
      if (s.ok) await scoreCorrection(db, s.correction);
    }
    const texts = ["naka nga def waay", "jerejef ba beneen yoon", "maa ngi fi rekk sama xarit"];
    const ids: string[] = [];
    for (const [i, w] of ws.entries()) {
      const s = await storeCorrection(db, w.correct("d1", texts[i]!));
      if (!s.ok) throw new Error(s.code);
      ids.push(s.correction.id);
      await scoreCorrection(db, s.correction);
    }
    expect((await db.select().from(clips).where(eq(clips.id, "d1")))[0]!.status).toBe("disputed");
    expect(await resolveDisputed(db, { clipId: "d1", correctionId: "00000000-0000-4000-8000-000000000000" })).toEqual({
      ok: false,
      code: "UNKNOWN_CORRECTION",
    });
    expect(await resolveDisputed(db, { clipId: "d1", correctionId: ids[2]! })).toMatchObject({ ok: true });
    expect(await resolveDisputed(db, { clipId: "d1", correctionId: ids[2]! })).toEqual({ ok: false, code: "NOT_DISPUTED" });
    expect(await claimableSats(db, ws[2]!.pubkey)).toBe(20 + 30);
    expect(await claimableSats(db, ws[0]!.pubkey)).toBe(20);

    const lines = (await exportJsonl(db)).trim().split("\n").map((l) => JSON.parse(l));
    expect(lines).toEqual([
      { clip_id: "d1", lang: "wo", consensus_text: texts[2], contributors: [ws[2]!.pubkey], attestation_event_id: null, license: "CC-BY-4.0" },
    ]);
    const sb = await computeScoreboard(db);
    expect(sb.langs).toEqual([expect.objectContaining({ lang: "wo", clips: 1, done: 1 })]);
    expect(sb.contributors).toBe(3);
    expect(JSON.stringify(sb)).not.toContain(ws[0]!.pubkey);
    expect((await db.select().from(workers)).length).toBe(3);
  });
});
