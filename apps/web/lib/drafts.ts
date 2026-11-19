/** Real AI drafts for seed clips (used by scripts/drafts.ts). Gemini audio input via @sats/ai. */
import { z } from "zod";
import { extractJson } from "@sats/ai";

const NAMES: Record<string, string> = {
  wo: "Wolof (Senegal). Use standard Latin Wolof orthography (CLAD: à é ë ó ñ ŋ, doubled letters for long vowels and geminates)",
  yo: "Yorùbá (Nigeria). Use standard Yorùbá orthography with tone marks and dot-below letters (ẹ ọ ṣ)",
  pcm: "Nigerian Pidgin (Naija). Write it the way Nigerians spell Pidgin, not standard English",
  ha: "Hausa (Nigeria/Niger). Use standard Latin Hausa orthography",
};

export const DraftOut = z.object({ text: z.string().max(500), confidence: z.number().min(0).max(1) });

export const draftSystem = (lang: string) =>
  `You are a speech-to-text system. Transcribe the audio clip verbatim in ${NAMES[lang] ?? lang}.
Write exactly the words spoken, in the spoken language. Do not translate, summarise, correct grammar or add punctuation beyond what is natural.
If a word is unclear, write your best guess. Return JSON: {"text": transcript, "confidence": your confidence from 0 to 1 that the transcript is exactly right}.`;

export function draftClip(lang: string, oggBase64: string) {
  return extractJson({ schema: DraftOut, system: draftSystem(lang), parts: [{ audio: { mime: "audio/ogg", base64: oggBase64 } }], timeoutMs: 45_000 });
}
