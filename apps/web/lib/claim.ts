/**
 * Claim authorisation. A claim is a Nostr event signed by the worker's key whose content is the
 * bolt11 to be paid, so only the key holder can direct their balance, and a signed claim can't be
 * reused for a different invoice. Replays of the same invoice are blocked by claims.payment_hash UNIQUE.
 */
import { verifyEvent, tagValue } from "@sats/nostr";
import { KIND_CLAIM } from "./protocol";

export const CLAIM_WINDOW_SEC = 5 * 60;
const BOLT11_RE = /^ln[a-z0-9]{10,1500}$/i;

export type ClaimAuthError = "INVALID_EVENT" | "WRONG_KIND" | "STALE" | "INVALID_INVOICE";

export function verifyClaimEvent(e: unknown, nowSec: number): { ok: true; pubkey: string; bolt11: string } | { ok: false; code: ClaimAuthError } {
  if (!verifyEvent(e)) return { ok: false, code: "INVALID_EVENT" };
  if (e.kind !== KIND_CLAIM || tagValue(e, "t") !== "kaddu-claim") return { ok: false, code: "WRONG_KIND" };
  if (Math.abs(e.created_at - nowSec) > CLAIM_WINDOW_SEC) return { ok: false, code: "STALE" };
  const bolt11 = e.content.trim();
  if (!BOLT11_RE.test(bolt11)) return { ok: false, code: "INVALID_INVOICE" };
  return { ok: true, pubkey: e.pubkey, bolt11 };
}
