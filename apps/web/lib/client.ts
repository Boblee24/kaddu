"use client";
/** Browser helpers: consent + language preference (localStorage, wrapped: it can throw in private mode). */
/** Languages offered to workers. Hausa is supported by the backend but has no seed clips yet. */
export const LANG_LABELS = { wo: "Wolof", yo: "Yorùbá", pcm: "Naija Pidgin" } as const;
export type WorkLang = keyof typeof LANG_LABELS;

const CONSENT_KEY = "kaddu:consent:v1";
const LANG_KEY = "kaddu:lang";

function get(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function put(k: string, v: string) {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* ignore */
  }
}

export const hasConsent = () => get(CONSENT_KEY) === "1";
export const giveConsent = () => put(CONSENT_KEY, "1");
export const savedLang = (): WorkLang | null => {
  const v = get(LANG_KEY);
  return v && v in LANG_LABELS ? (v as WorkLang) : null;
};
export const saveLang = (l: WorkLang) => put(LANG_KEY, l);
