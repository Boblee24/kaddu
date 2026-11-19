/**
 * pnpm fetch:yoruba [--max 40]: Yoruba clips from OpenSLR SLR86 (CC BY-SA 4.0).
 * The archives are ~450 MB each, so this reads only the zip directory and the ~40 WAV entries it needs
 * via HTTP range requests (a few MB in total). Half female, half male speakers; different speakers
 * where possible. Rewrites the `yo` entries in seed/manifest.json.
 */
import { parseArgs } from "node:util";
import { durationSec, isGold, listRemoteZip, plausible, readRemoteZipEntry, saveClip, toOpus, writeManifest, type Entry } from "./_seedlib";

const { values } = parseArgs({ options: { max: { type: "string", default: "40" } } });
const MAX = Number(values.max);
const BASE = "https://www.openslr.org/resources/86";

async function size(url: string): Promise<number> {
  const res = await fetch(url, { method: "HEAD", redirect: "follow" });
  return Number(res.headers.get("content-length"));
}

const entries: Entry[] = [];
for (const gender of ["female", "male"] as const) {
  const want = Math.ceil(MAX / 2);
  const index = new Map(
    (await (await fetch(`${BASE}/line_index_${gender}.tsv`)).text())
      .split("\n")
      .map((l) => l.split("\t"))
      .filter((p) => p.length >= 2 && p[1]!.trim())
      .map((p) => [p[0]!.trim(), p[1]!.trim()] as const),
  );
  const zipUrl = `${BASE}/yo_ng_${gender}.zip`;
  const files = await listRemoteZip(zipUrl, await size(zipUrl));
  console.log(`• ${gender}: ${files.length} zip entries, ${index.size} transcripts`);
  const seenSpeakers = new Set<string>();
  let got = 0;
  // Prefer one clip per speaker (ids look like yof_06136_00616155826: speaker 06136).
  for (const pass of [0, 1]) {
    for (const f of files) {
      if (got >= want || entries.length >= MAX) break;
      const id0 = f.name.split("/").pop()!.replace(/\.wav$/, "");
      const text = index.get(id0);
      const speaker = id0.split("_")[1] ?? "";
      // Skip transcripts with digits or annotation tags such as [snap] / [noise].
      if (!text || !f.name.endsWith(".wav") || /[\d[\]<>]/.test(text)) continue;
      if (pass === 0 && seenSpeakers.has(speaker)) continue;
      if (entries.some((e) => e.truth_text === text)) continue;
      const ogg = toOpus(await readRemoteZipEntry(zipUrl, f));
      const sec = await durationSec(ogg);
      if (sec < 2.5 || sec > 10 || ogg.length > 200_000 || !plausible(text, sec)) continue;
      seenSpeakers.add(speaker);
      const id = `yo_${String(entries.length + 1).padStart(3, "0")}`;
      entries.push({ id, lang: "yo", file: saveClip("yo", id, ogg), truth_text: text, is_gold: isGold(entries.length) });
      got++;
      console.log(`  + ${id} ${sec.toFixed(1)} s (${gender}, speaker ${speaker})`);
    }
  }
}
writeManifest("yo", entries);
console.log(`✓ Yoruba: ${entries.length} clips (${entries.filter((e) => e.is_gold).length} gold). Licence: CC BY-SA 4.0 (OpenSLR SLR86).`);
