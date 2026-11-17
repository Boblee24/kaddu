import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { setLogSink } from "@sats/core/log";
import type { Db } from "@sats/payouts";
import { runPersonas, typo } from "./personas";
import { addClip, makeTestDb, makeWorker } from "./testDb";
import { storeCorrection } from "./corrections";
import { scoreCorrection } from "./score";
import { clips } from "./db/schema";
import { agreementCer } from "./text";

let db: Db;
let close: () => Promise<void>;
const restoreLog = setLogSink(() => {});
beforeAll(async () => ({ db, close } = await makeTestDb()));
afterAll(async () => {
  restoreLog();
  await close();
});

const keys = () => [0, 1, 2].map(() => randomBytes(32).toString("hex")) as [string, string, string];

describe("typo", () => {
  it("stays within the agreement threshold but differs", () => {
    const t = "maa ngi fi rekk, jërëjëf sama xarit";
    for (let s = 1; s < 10; s++) {
      expect(typo(t, s)).not.toBe(t);
      expect(agreementCer(t, typo(t, s))).toBeLessThanOrEqual(0.15);
    }
  });
});

describe("runPersonas", () => {
  it("leaves every open clip one submission from consensus, idempotently", async () => {
    await addClip(db, { id: "g1", gold: true, truth: "naka nga def jerejef" });
    await addClip(db, { id: "g2", gold: true, truth: "jerejef sama xarit bi" });
    await addClip(db, { id: "a", truth: "maa ngi fi rekk jerejef", draft: "ma ngi fii" });
    await addClip(db, { id: "b", truth: "ba beneen yoon inshallah", draft: "ba ben yon" });
    await addClip(db, { id: "c", truth: "naka sa yaram ndax mu baax", draft: "naka sa yarame" });
    const nsecs = keys();
    const s = await runPersonas(db, nsecs);
    expect(s).toMatchObject({ qualified: 6, presubmitted: 6, clips: 3 });
    await runPersonas(db, nsecs); // re-run: no duplicates, no errors

    for (const id of ["a", "b", "c"]) {
      const [c] = await db.select().from(clips).where(eq(clips.id, id));
      expect(c!.status).toBe("open");
    }
    // Live worker (qualified) is the 3rd: consensus forms instantly.
    const live = makeWorker();
    for (const g of ["g1", "g2"]) {
      const r = await storeCorrection(db, live.correct(g, (await db.select().from(clips).where(eq(clips.id, g)))[0]!.truthText!));
      if (r.ok) await scoreCorrection(db, r.correction);
    }
    const r = await storeCorrection(db, live.correct("c", "Naka sa yaram? Ndax mu baax"));
    if (!r.ok) throw new Error(r.code);
    expect(await scoreCorrection(db, r.correction)).toMatchObject({ decision: "accepted", consensus: true, sats: 30 });
  });
});
