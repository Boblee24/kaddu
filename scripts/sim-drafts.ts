/**
 * pnpm drafts:simulated → seed/drafts.json with PLACEHOLDER drafts (no Gemini key yet).
 * Each draft is the true transcript corrupted the way weak ASR output looks (tone marks dropped,
 * words merged, misheard, dropped). They are stored with draft_model "simulated" and the UI labels
 * them "Simulated draft". `pnpm drafts` (real Gemini) overwrites them when a key is available.
 * Existing non-simulated drafts are kept.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { readManifest } from "./_seedlib";
import { rng, syntheticDraft } from "../apps/web/lib/evaldata";

type Draft = { text: string; model: string; confidence: number | null };
const path = "seed/drafts.json";
const drafts: Record<string, Draft> = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
const r = rng(2026);
let made = 0;
for (const e of readManifest()) {
  if (drafts[e.id] && drafts[e.id]!.model !== "simulated") continue;
  drafts[e.id] = { text: syntheticDraft(e.truth_text, r), model: "simulated", confidence: null };
  made++;
}
writeFileSync(path, JSON.stringify(drafts, null, 2) + "\n");
console.log(`✓ seed/drafts.json: ${made} simulated placeholder draft(s); ${Object.keys(drafts).length} total`);
