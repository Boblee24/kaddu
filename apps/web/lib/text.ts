/**
 * Text comparison for transcripts. Pure functions; no I/O.
 *
 * normalize: NFC, lowercase, punctuation stripped, whitespace collapsed. Diacritics are KEPT
 * (they carry meaning, e.g. Yoruba tone marks). stripDiacritics removes them for the
 * diacritic-insensitive comparisons the scoring uses, because tone marks are typed inconsistently.
 */

/** Unicode letters, marks and numbers survive; everything else (punctuation, symbols) becomes a space. */
const NON_WORD = /[^\p{L}\p{M}\p{N}\s]/gu;

export function normalize(t: string): string {
  return t
    .normalize("NFC")
    .toLowerCase()
    .replace(/[’‘'`ʼ]/g, "") // apostrophes join words ("dafa'y" ~ "dafay"); handled before NON_WORD
    .replace(NON_WORD, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Remove combining marks (tone marks, accents, dot-below) and fold letters NFD can't decompose. */
export function stripDiacritics(t: string): string {
  return t
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[ŋŊ]/g, (c) => (c === "ŋ" ? "n" : "N")) // Wolof eng: often typed as "n"/"ng"
    .replace(/[ɓƁ]/g, (c) => (c === "ɓ" ? "b" : "B")) // Hausa hooked letters
    .replace(/[ɗƊ]/g, (c) => (c === "ɗ" ? "d" : "D"))
    .replace(/[ƙƘ]/g, (c) => (c === "ƙ" ? "k" : "K"))
    .replace(/[ƴƳ]/g, (c) => (c === "ƴ" ? "y" : "Y"))
    .normalize("NFC");
}

/** normalize + stripDiacritics: the key used for every scoring comparison. */
export function fold(t: string): string {
  return stripDiacritics(normalize(t));
}

/** Levenshtein distance over arrays (code points or words). O(n*m) time, O(m) memory. */
export function levenshtein<T>(a: readonly T[], b: readonly T[]): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  let cur = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[b.length]!;
}

/** Split into Unicode code points (not UTF-16 units): astral chars and emoji count once. */
const chars = (s: string) => Array.from(s);
const words = (s: string) => (s ? s.split(" ") : []);

/**
 * Error rate of `hyp` against `ref`: edits / reference length.
 * Both empty → 0. Empty reference with a non-empty hypothesis → 1 (capped; an insertion-only
 * rate has no denominator). Can exceed 1 when the hypothesis is much longer than the reference.
 */
function rate(edits: number, refLen: number, hypLen: number): number {
  if (refLen === 0) return hypLen === 0 ? 0 : 1;
  return edits / refLen;
}

export type CompareOpts = { diacritics?: boolean };

const prep = (t: string, o: CompareOpts) => (o.diacritics === false ? fold(t) : normalize(t));

/** Character error rate on normalized text. Pass `{ diacritics: false }` to ignore diacritics. */
export function cer(ref: string, hyp: string, o: CompareOpts = {}): number {
  const r = chars(prep(ref, o));
  const h = chars(prep(hyp, o));
  return rate(levenshtein(r, h), r.length, h.length);
}

/** Word error rate on normalized text. Pass `{ diacritics: false }` to ignore diacritics. */
export function wer(ref: string, hyp: string, o: CompareOpts = {}): number {
  const r = words(prep(ref, o));
  const h = words(prep(hyp, o));
  return rate(levenshtein(r, h), r.length, h.length);
}

/**
 * Symmetric, diacritic-insensitive CER used for agreement between two workers
 * (neither side is "the reference"): edits / max(len).
 */
export function agreementCer(a: string, b: string): number {
  const x = chars(fold(a));
  const y = chars(fold(b));
  const n = Math.max(x.length, y.length);
  return n === 0 ? 0 : levenshtein(x, y) / n;
}
