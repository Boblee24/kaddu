/**
 * Deterministic checks (CLAUDE.md scoring step 2). Pure; the DB-backed copy check lives in score.ts.
 * `unchanged` is informational (allowed, paid only through consensus); `hard` lists reject reasons.
 */
import { fold, normalize } from "./text";

export const MIN_CPS = 2;
export const MAX_CPS = 25;

export type HardFlag = "empty" | "implausible_length" | "digits_only" | "url" | "emoji" | "wrong_script" | "copy_other_clip";

export type Checks = {
  unchanged: boolean;
  cps: number;
  hard: HardFlag[];
  copyOtherClip?: boolean;
};

const URL_RE = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|io|ly|me|sn|ng)\b)/i;
const EMOJI_RUN_RE = /\p{Extended_Pictographic}/u;
// Letters from a non-Latin script (Arabic, Cyrillic, CJK, …). Latin + combining marks + IPA-ish letters pass.
const NON_LATIN_LETTER_RE = /(?!\p{Script=Latin})\p{L}/u;

export function deterministicChecks(o: { text: string; draft: string; durationMs: number }): Checks {
  const n = normalize(o.text);
  const hard: HardFlag[] = [];
  const letters = Array.from(n.replace(/\s/g, "")).length;
  const cps = o.durationMs > 0 ? letters / (o.durationMs / 1000) : 0;

  if (n.length === 0) hard.push("empty");
  else {
    if (cps < MIN_CPS || cps > MAX_CPS) hard.push("implausible_length");
    if (/^[\d\s]+$/.test(n)) hard.push("digits_only");
  }
  if (URL_RE.test(o.text)) hard.push("url");
  if (EMOJI_RUN_RE.test(o.text)) hard.push("emoji");
  if (NON_LATIN_LETTER_RE.test(n)) hard.push("wrong_script");

  return {
    unchanged: n.length > 0 && n === normalize(o.draft),
    cps: Math.round(cps * 10) / 10,
    hard,
  };
}

/** Same text as another clip's consensus (diacritic-insensitive). */
export function isCopyOf(text: string, others: string[]): boolean {
  const f = fold(text);
  return f.length > 0 && others.some((o) => fold(o) === f);
}
