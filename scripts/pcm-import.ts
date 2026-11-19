/**
 * pnpm pcm:import: turn your Pidgin recordings into seed clips.
 *   1. Record each line of seed/pcm_script.md and save as seed/clips/pcm/pcm_01.m4a, pcm_02.m4a, …
 *      (.m4a/.mp3/.wav/.aac/.webm/.ogg/.opus all work; edit the script line if you said it differently).
 *   2. pnpm pcm:import   → seed/clips/pcm/pcm_NN.ogg (16 kHz mono Opus) + manifest entries, ~25% gold.
 * Reports script lines with no recording, recordings with no script line, and clips that look too
 * short/long for their sentence. Raw recordings stay local (gitignored); only the .ogg files are committed.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { SEED, durationSec, isGold, plausible, saveClip, toOpus, writeManifest, type Entry } from "./_seedlib";

const script = readFileSync(path.join(SEED, "pcm_script.md"), "utf8");
const lines = new Map<string, string>();
for (const m of script.matchAll(/^\|\s*(pcm_\d{2})\s*\|\s*(.+?)\s*\|\s*$/gm)) lines.set(m[1]!, m[2]!);
if (lines.size === 0) throw new Error("no `| pcm_NN | sentence |` rows found in seed/pcm_script.md");

const dir = path.join(SEED, "clips", "pcm");
const raw = new Map<string, string>();
for (const f of readdirSync(dir)) {
  const m = /^(pcm_\d{2})\.(m4a|mp3|wav|aac|webm|opus|ogg|caf|3gp)$/i.exec(f);
  if (!m) continue;
  const id = m[1]!.toLowerCase();
  // Prefer the raw recording over a previously converted .ogg.
  if (!raw.has(id) || m[2]!.toLowerCase() !== "ogg") raw.set(id, path.join(dir, f));
}

const entries: Entry[] = [];
const missing: string[] = [];
const warnings: string[] = [];
for (const [id, text] of [...lines].sort(([a], [b]) => a.localeCompare(b))) {
  const file = raw.get(id);
  if (!file) {
    missing.push(id);
    continue;
  }
  const ogg = file.endsWith(".ogg") ? readFileSync(file) : toOpus(readFileSync(file));
  const sec = await durationSec(ogg);
  if (sec > 15 || ogg.length > 200_000) {
    warnings.push(`${id}: ${sec.toFixed(1)} s / ${ogg.length} B is over the 15 s / 200 KB limit, skipped`);
    continue;
  }
  if (!plausible(text, sec)) warnings.push(`${id}: ${sec.toFixed(1)} s looks wrong for "${text}" (check the file matches the line)`);
  entries.push({ id, lang: "pcm", file: saveClip("pcm", id, ogg), truth_text: text, is_gold: isGold(entries.length) });
  console.log(`  + ${id} ${sec.toFixed(1)} s`);
}
const extra = [...raw.keys()].filter((id) => !lines.has(id));

writeManifest("pcm", entries);
console.log(`✓ Pidgin: ${entries.length}/${lines.size} clips imported (${entries.filter((e) => e.is_gold).length} gold)`);
if (missing.length) console.log(`• no recording yet for: ${missing.join(", ")}`);
if (extra.length) console.log(`• recordings with no script line (ignored): ${extra.join(", ")}`);
for (const w of warnings) console.log(`• ${w}`);
if (entries.length > 0) console.log("Next: pnpm seed (local) and DATABASE_URL=<neon> pnpm seed");
