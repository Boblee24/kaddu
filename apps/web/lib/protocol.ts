/** Shared client/server constants for the correction event. Browser-safe. */
import { z } from "zod";
import { LANGS } from "./db/langs";

/** Nostr kind for a signed correction (regular, app-specific; not published to relays). */
export const KIND_CORRECTION = 4078;
/** Attestation kind (parameterized replaceable, `d` = clip_id). */
export const KIND_ATTESTATION = 30078;
export const MAX_TEXT = 500;

export const ClipId = z.string().regex(/^[a-z0-9_-]{1,64}$/);
export const Pubkey = z.string().regex(/^[0-9a-f]{64}$/);
export const Lang = z.enum(LANGS);

/** The signed event's `content` is JSON of this shape. */
export const CorrectionContent = z.object({ clip_id: ClipId, text: z.string().max(MAX_TEXT) }).strict();

/** What /api/next returns. Never truth_text or is_gold. */
export type ClipTask = {
  id: string;
  lang: (typeof LANGS)[number];
  durationMs: number;
  draftText: string;
  priceSats: number;
  audioUrl: string;
};

export type SubmitResult =
  | { ok: true; correctionId: string; decision: "pending" | "accepted" | "rejected"; code?: string; sats?: number; consensus?: boolean; attestationId?: string }
  | { ok: false; code: string };
