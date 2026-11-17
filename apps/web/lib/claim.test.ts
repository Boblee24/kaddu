import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { signWithKey } from "@sats/nostr";
import { makeTestInvoice } from "@sats/lightning/testInvoice";
import { verifyClaimEvent, CLAIM_WINDOW_SEC } from "./claim";
import { KIND_CLAIM } from "./protocol";

const sk = Uint8Array.from(randomBytes(32));
const now = Math.floor(Date.now() / 1000);
const bolt11 = makeTestInvoice({ sats: 50, paymentHash: randomBytes(32).toString("hex") });
const ev = (o: { kind?: number; content?: string; t?: string; at?: number } = {}) =>
  signWithKey({ kind: o.kind ?? KIND_CLAIM, content: o.content ?? bolt11, tags: [["t", o.t ?? "kaddu-claim"]], created_at: o.at ?? now }, sk);

describe("verifyClaimEvent", () => {
  it("accepts a fresh signed claim and returns the signer as the pubkey", () => {
    const e = ev();
    expect(verifyClaimEvent(e, now)).toEqual({ ok: true, pubkey: e.pubkey, bolt11 });
  });

  it("rejects tampering (swapping the invoice breaks the signature)", () => {
    const other = makeTestInvoice({ sats: 50, paymentHash: randomBytes(32).toString("hex") });
    expect(verifyClaimEvent({ ...ev(), content: other }, now)).toEqual({ ok: false, code: "INVALID_EVENT" });
  });

  it("rejects wrong kind/tag, stale, future, non-invoice content", () => {
    expect(verifyClaimEvent(ev({ kind: 1 }), now)).toMatchObject({ code: "WRONG_KIND" });
    expect(verifyClaimEvent(ev({ t: "other" }), now)).toMatchObject({ code: "WRONG_KIND" });
    expect(verifyClaimEvent(ev({ at: now - CLAIM_WINDOW_SEC - 1 }), now)).toMatchObject({ code: "STALE" });
    expect(verifyClaimEvent(ev({ at: now + CLAIM_WINDOW_SEC + 1 }), now)).toMatchObject({ code: "STALE" });
    expect(verifyClaimEvent(ev({ content: "hello" }), now)).toMatchObject({ code: "INVALID_INVOICE" });
    expect(verifyClaimEvent(null, now)).toMatchObject({ code: "INVALID_EVENT" });
  });
});
