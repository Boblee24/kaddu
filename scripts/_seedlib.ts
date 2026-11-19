/**
 * Seed helpers: audio → 16 kHz mono Opus (via ffmpeg-static; no system ffmpeg needed),
 * manifest merge, and a byte-range zip reader so we can take a few files out of a 460 MB archive.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { inflateRawSync } from "node:zlib";
import { durationMs } from "../apps/web/lib/seed";

const require = createRequire(import.meta.url);
const ffmpeg = require("ffmpeg-static") as string;

export const SEED = path.resolve("seed");
export type Entry = { id: string; lang: "wo" | "yo" | "pcm" | "ha"; file: string; truth_text: string; is_gold: boolean };

/** Any audio → trimmed 16 kHz mono Opus (16 kb/s). Leading/trailing silence is removed. */
export function toOpus(input: Uint8Array): Buffer {
  const trim = "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.15,areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.15,areverse";
  const r = spawnSync(
    ffmpeg,
    ["-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-af", trim, "-ac", "1", "-ar", "16000", "-c:a", "libopus", "-b:a", "16k", "-f", "ogg", "pipe:1"],
    { input, maxBuffer: 20 * 1024 * 1024 },
  );
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr.toString().slice(0, 200)}`);
  return r.stdout;
}

export async function durationSec(ogg: Uint8Array): Promise<number> {
  return (await durationMs(ogg, "audio/ogg")) / 1000;
}

/** Same plausibility rule the app applies to corrections: 2–25 letters per second. */
export function plausible(text: string, sec: number): boolean {
  const letters = Array.from(text.replace(/[^\p{L}]/gu, "")).length;
  return sec > 0 && letters / sec >= 2.5 && letters / sec <= 22; // a little inside the app's bounds
}

export function readManifest(): Entry[] {
  const p = path.join(SEED, "manifest.json");
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as Entry[]) : [];
}

/** Replace all entries of `lang` with `entries`; keep other languages. */
export function writeManifest(lang: Entry["lang"], entries: Entry[]): void {
  const keep = readManifest().filter((e) => e.lang !== lang);
  const all = [...keep, ...entries].sort((a, b) => a.id.localeCompare(b.id));
  writeFileSync(path.join(SEED, "manifest.json"), JSON.stringify(all, null, 2) + "\n");
}

export function saveClip(lang: string, id: string, ogg: Uint8Array): string {
  const dir = path.join(SEED, "clips", lang);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${id}.ogg`), ogg);
  return `clips/${lang}/${id}.ogg`;
}

/** Every 4th clip is gold (~25%), and at least the first 2 (qualification). */
export const isGold = (i: number) => i < 2 || i % 4 === 0;

// ---- byte-range zip reader ----------------------------------------------------------------------

async function range(url: string, start: number, end: number): Promise<Buffer> {
  const res = await fetch(url, { headers: { range: `bytes=${start}-${end}` } });
  if (res.status !== 206) throw new Error(`range request failed: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

export type ZipEntry = { name: string; method: number; compSize: number; offset: number };

/** List a remote zip's entries by reading only its end-of-central-directory and central directory. */
export async function listRemoteZip(url: string, size: number): Promise<ZipEntry[]> {
  const tail = await range(url, Math.max(0, size - 65_557), size - 1);
  let eocd = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error("no EOCD");
  let cdSize = tail.readUInt32LE(eocd + 12);
  let cdOffset = tail.readUInt32LE(eocd + 16);
  if (cdOffset === 0xffffffff || cdSize === 0xffffffff) {
    // ZIP64: locator sits just before the EOCD.
    const loc = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x06, 0x07]), eocd);
    const z64 = Number(tail.readBigUInt64LE(loc + 8));
    const rec = await range(url, z64, z64 + 55);
    cdSize = Number(rec.readBigUInt64LE(40));
    cdOffset = Number(rec.readBigUInt64LE(48));
    eocd = -1;
  }
  const cd = await range(url, cdOffset, cdOffset + cdSize - 1);
  const out: ZipEntry[] = [];
  for (let p = 0; p + 46 <= cd.length && cd.readUInt32LE(p) === 0x02014b50; ) {
    const method = cd.readUInt16LE(p + 10);
    let compSize = cd.readUInt32LE(p + 20);
    const nameLen = cd.readUInt16LE(p + 28);
    const extraLen = cd.readUInt16LE(p + 30);
    const commentLen = cd.readUInt16LE(p + 32);
    let offset = cd.readUInt32LE(p + 42);
    const name = cd.toString("utf8", p + 46, p + 46 + nameLen);
    // ZIP64 extra field (0x0001) carries 64-bit sizes/offset when the 32-bit ones are maxed out.
    let e = p + 46 + nameLen;
    const eEnd = e + extraLen;
    while (e + 4 <= eEnd) {
      const id = cd.readUInt16LE(e);
      const len = cd.readUInt16LE(e + 2);
      if (id === 0x0001) {
        let q = e + 4;
        if (cd.readUInt32LE(p + 24) === 0xffffffff) q += 8; // uncompressed size
        if (compSize === 0xffffffff) {
          compSize = Number(cd.readBigUInt64LE(q));
          q += 8;
        }
        if (offset === 0xffffffff) offset = Number(cd.readBigUInt64LE(q));
      }
      e += 4 + len;
    }
    out.push({ name, method, compSize, offset });
    p = eEnd + commentLen;
  }
  return out;
}

export async function readRemoteZipEntry(url: string, e: ZipEntry): Promise<Buffer> {
  const head = await range(url, e.offset, e.offset + 29);
  const dataStart = e.offset + 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
  const data = await range(url, dataStart, dataStart + e.compSize - 1);
  if (e.method === 0) return data;
  if (e.method === 8) return inflateRawSync(data);
  throw new Error(`unsupported zip method ${e.method}`);
}
