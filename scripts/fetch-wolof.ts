/**
 * pnpm fetch:wolof [--max 40]: Wolof clips from Hugging Face `galsenai/wolof-audio-data` (Apache-2.0)
 * via the public datasets-server rows API (no Python, no full download). Keeps 3–10 s clips whose
 * transcript length fits the audio; converts to 16 kHz mono Opus; ~25% gold. Rewrites the `wo` entries.
 */
import { parseArgs } from "node:util";
import { durationSec, isGold, plausible, saveClip, toOpus, writeManifest, type Entry } from "./_seedlib";

const { values } = parseArgs({ options: { max: { type: "string", default: "40" }, split: { type: "string", default: "test" } } });
const MAX = Number(values.max);
const API = "https://datasets-server.huggingface.co/rows?dataset=galsenai%2Fwolof-audio-data&config=default";

type Row = { row_idx: number; row: { audio: Array<{ src: string; type: string }>; sentence: string; source: string } };

const entries: Entry[] = [];
let offset = 0;
let looked = 0;
while (entries.length < MAX && looked < 600) {
  const res = await fetch(`${API}&split=${values.split}&offset=${offset}&length=50`);
  if (!res.ok) throw new Error(`datasets-server HTTP ${res.status}`);
  const { rows } = (await res.json()) as { rows: Row[] };
  if (!rows.length) break;
  offset += rows.length;
  for (const r of rows) {
    if (entries.length >= MAX) break;
    looked++;
    const text = r.row.sentence?.trim();
    const src = r.row.audio?.[0]?.src;
    if (!text || !src || text.length > 300 || /[\d[\]<>]/.test(text)) continue; // no digits or annotation tags
    const audio = new Uint8Array(await (await fetch(src)).arrayBuffer());
    let ogg: Buffer;
    try {
      ogg = toOpus(audio);
    } catch {
      continue;
    }
    const sec = await durationSec(ogg);
    if (sec < 3 || sec > 10 || ogg.length > 200_000 || !plausible(text, sec)) continue;
    const id = `wo_${String(entries.length + 1).padStart(3, "0")}`;
    entries.push({ id, lang: "wo", file: saveClip("wo", id, ogg), truth_text: text, is_gold: isGold(entries.length) });
    console.log(`  + ${id} ${sec.toFixed(1)} s (${r.row.source}, row ${r.row_idx})`);
  }
}
writeManifest("wo", entries);
console.log(`✓ Wolof: ${entries.length} clips (${entries.filter((e) => e.is_gold).length} gold) from ${looked} rows`);
