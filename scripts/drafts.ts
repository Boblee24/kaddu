/**
 * pnpm drafts [--lang wo,yo,pcm] [--force]: real AI drafts for the seed clips → seed/drafts.json.
 * Gemini (audio input, via @sats/ai extractJson) for every language. The spec routes yo/ha to Spitch, but no Spitch
 * key was available, so Yorùbá also uses Gemini (noted in the README).
 * `confidence` is the model's own estimate (a heuristic, not a calibrated probability).
 * Keeps existing real drafts unless --force; replaces simulated ones. Prints ids, CER and latency only.
 * Then `pnpm seed:clips` (and with the Neon DATABASE_URL) to load them.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { loadEnvLocal } from "./_env";
import { readManifest, SEED } from "./_seedlib";

loadEnvLocal();
const { values } = parseArgs({ options: { lang: { type: "string", default: "wo,yo,pcm" }, force: { type: "boolean", default: false } } });
const LANGS = new Set(values.lang!.split(","));
if (process.env.AI_MOCK === "1" || !process.env.GEMINI_API_KEY) {
  console.error("✗ needs GEMINI_API_KEY and AI_MOCK=0 in .env.local");
  process.exit(1);
}

const { draftClip } = await import("../apps/web/lib/drafts");
const { cer } = await import("../apps/web/lib/text");

type Draft = { text: string; model: string; confidence: number | null };
const file = path.join(SEED, "drafts.json");
const drafts: Record<string, Draft> = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
const todo = readManifest().filter((e) => LANGS.has(e.lang) && (values.force || !drafts[e.id] || drafts[e.id]!.model === "simulated"));
console.log(`Drafting ${todo.length} clip(s) with Gemini (${process.env.GEMINI_MODEL})…`);

const perLang = new Map<string, { n: number; cer: number; fail: number; ms: number[] }>();
for (const e of todo) {
  const s = perLang.get(e.lang) ?? { n: 0, cer: 0, fail: 0, ms: [] };
  perLang.set(e.lang, s);
  const audio = readFileSync(path.join(SEED, e.file)).toString("base64");
  let r = await draftClip(e.lang, audio);
  if (!r.ok && r.reason === "api_error") {
    await new Promise((res) => setTimeout(res, 8000)); // likely a rate limit: back off once
    r = await draftClip(e.lang, audio);
  }
  if (!r.ok) {
    s.fail++;
    console.log(`  ${e.id}: failed (${r.reason})`);
    continue;
  }
  const text = r.data.text.trim().slice(0, 500);
  drafts[e.id] = { text, model: r.model, confidence: Math.round(r.data.confidence * 100) / 100 };
  const c = cer(e.truth_text, text);
  s.n++;
  s.cer += c;
  s.ms.push(r.latencyMs);
  console.log(`  ${e.id}: CER ${c.toFixed(2)}  conf ${r.data.confidence.toFixed(2)}  ${r.latencyMs} ms`);
  writeFileSync(file, JSON.stringify(drafts, null, 2) + "\n"); // save as we go
  await new Promise((res) => setTimeout(res, 1500));
}
for (const [lang, s] of perLang) {
  const sorted = [...s.ms].sort((a, b) => a - b);
  console.log(`✓ ${lang}: ${s.n} drafted, ${s.fail} failed, mean CER ${(s.cer / Math.max(1, s.n)).toFixed(2)}, p50 ${sorted[Math.floor(sorted.length / 2)] ?? "-"} ms`);
}
process.exit(0);
