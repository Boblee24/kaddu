/**
 * Server price table. The ONLY source of payout amounts (AI never sets amounts).
 * base 20 sats, +10 if the draft is low-confidence (< 0.6), +10 if the clip is long (> 6 s).
 */
export const PRICE = { base: 20, lowConfidence: 10, long: 10, lowConfidenceBelow: 0.6, longOverMs: 6000 } as const;

export function priceSats(o: { durationMs: number; draftConfidence: number | null | undefined }): number {
  let p = PRICE.base;
  // No draft confidence (no draft yet) counts as low confidence: the worker has more to type.
  if (o.draftConfidence == null || o.draftConfidence < PRICE.lowConfidenceBelow) p += PRICE.lowConfidence;
  if (o.durationMs > PRICE.longOverMs) p += PRICE.long;
  return p;
}
