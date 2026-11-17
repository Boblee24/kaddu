import { describe, expect, it } from "vitest";
import { agreementCer, cer, fold, levenshtein, normalize, stripDiacritics, wer } from "./text";

describe("normalize", () => {
  it("lowercases, strips punctuation, collapses whitespace", () => {
    expect(normalize("  Salaam,   aleekum!!  ")).toBe("salaam aleekum");
    expect(normalize("How you dey? I dey—fine.")).toBe("how you dey i dey fine");
    expect(normalize("«Bonjour» (yes) [no] {x} ... ;:")).toBe("bonjour yes no x");
    expect(normalize("tab\tand\nnewline")).toBe("tab and newline");
  });

  it("joins apostrophes instead of splitting the word", () => {
    expect(normalize("dama'y dem")).toBe("damay dem");
    expect(normalize("I don’t know")).toBe("i dont know");
  });

  it("keeps diacritics and applies NFC (composed and decomposed input match)", () => {
    const composed = "ọmọ"; // o with dot below, precomposed
    const decomposed = "ọmọ";
    expect(normalize(decomposed)).toBe(normalize(composed));
    expect(normalize("Ẹ KÁÀBỌ̀")).toBe("ẹ káàbọ̀");
    expect(normalize("Jërëjëf")).toBe("jërëjëf");
  });

  it("keeps digits and non-Latin letters", () => {
    expect(normalize("Mo ní 3 ọmọ")).toBe("mo ní 3 ọmọ");
    expect(normalize("ŋ Ŋ ɓ ƙ")).toBe("ŋ ŋ ɓ ƙ");
  });

  it("handles empty and punctuation-only input", () => {
    expect(normalize("")).toBe("");
    expect(normalize("   ")).toBe("");
    expect(normalize("?!.,")).toBe("");
  });
});

describe("stripDiacritics / fold", () => {
  it("removes Yoruba tone marks and dot-below", () => {
    expect(stripDiacritics("Ẹ káàbọ̀")).toBe("E kaabo");
    expect(stripDiacritics("ọmọ ṣé")).toBe("omo se");
  });

  it("removes Wolof diacritics and folds eng", () => {
    expect(stripDiacritics("Jërëjëf, ñaata la?")).toBe("Jerejef, naata la?");
    expect(stripDiacritics("ŋaam")).toBe("naam");
    expect(stripDiacritics("dégg naa")).toBe("degg naa");
  });

  it("folds Hausa hooked letters", () => {
    expect(stripDiacritics("ɓaƙi ɗaya ƴa")).toBe("baki daya ya");
  });

  it("fold = normalize + strip", () => {
    expect(fold("  Ẹ KÁÀBỌ̀ !")).toBe("e kaabo");
    expect(fold("")).toBe("");
  });
});

describe("levenshtein", () => {
  it("classic cases", () => {
    expect(levenshtein([..."kitten"], [..."sitting"])).toBe(3);
    expect(levenshtein([..."abc"], [..."abc"])).toBe(0);
    expect(levenshtein([], [..."abc"])).toBe(3);
    expect(levenshtein([..."abc"], [])).toBe(3);
    expect(levenshtein([], [])).toBe(0);
    expect(levenshtein(["a", "b"], ["b", "a"])).toBe(2);
  });

  it("is symmetric", () => {
    const a = [..."jërëjëf"];
    const b = [..."jerejef waay"];
    expect(levenshtein(a, b)).toBe(levenshtein(b, a));
  });
});

describe("cer", () => {
  it("is 0 for identical text after normalization", () => {
    expect(cer("Na wa o!", "na wa o")).toBe(0);
  });

  it("counts character edits over reference length", () => {
    expect(cer("abcd", "abcx")).toBe(0.25);
    expect(cer("abcd", "ab")).toBe(0.5);
  });

  it("is diacritic-sensitive by default and insensitive on request", () => {
    expect(cer("ọmọ", "omo")).toBeGreaterThan(0);
    expect(cer("ọmọ", "omo", { diacritics: false })).toBe(0);
    expect(cer("Ẹ káàbọ̀", "e kaabo", { diacritics: false })).toBe(0);
  });

  it("treats composed and decomposed forms as equal", () => {
    expect(cer("ọmọ", "ọmọ")).toBe(0);
  });

  it("empty strings", () => {
    expect(cer("", "")).toBe(0);
    expect(cer("", "abc")).toBe(1);
    expect(cer("abc", "")).toBe(1);
    expect(cer("...", "!!!")).toBe(0);
  });

  it("can exceed 1 for long garbage hypotheses", () => {
    expect(cer("ab", "xxxxxxxx")).toBeGreaterThan(1);
  });

  it("small typos stay under the 0.15 agreement threshold", () => {
    const truth = "Naka nga def? Maa ngi fi rekk, jërëjëf.";
    expect(cer(truth, "naka nga def maa ngi fi rek jerejef", { diacritics: false })).toBeLessThanOrEqual(0.15);
  });
});

describe("wer", () => {
  it("counts word edits", () => {
    expect(wer("how you dey", "how you dey")).toBe(0);
    expect(wer("how you dey", "how u dey")).toBeCloseTo(1 / 3);
    expect(wer("how you dey", "how you")).toBeCloseTo(1 / 3);
    expect(wer("how you dey", "how you dey today")).toBeCloseTo(1 / 3);
  });

  it("punctuation and case don't count", () => {
    expect(wer("Bawo ni?", "bawo ni")).toBe(0);
  });

  it("diacritic option", () => {
    expect(wer("ẹ káàbọ̀", "e kaabo")).toBe(1);
    expect(wer("ẹ káàbọ̀", "e kaabo", { diacritics: false })).toBe(0);
  });

  it("empty strings", () => {
    expect(wer("", "")).toBe(0);
    expect(wer("", "hello")).toBe(1);
    expect(wer("hello world", "")).toBe(1);
  });
});

describe("agreementCer", () => {
  it("is symmetric and diacritic-insensitive", () => {
    const a = "Ẹ káàbọ̀ o, ṣé dáadáa ni?";
    const b = "e kaabo o se daadaa ni";
    expect(agreementCer(a, b)).toBe(0);
    expect(agreementCer("abcd", "abc")).toBe(agreementCer("abc", "abcd"));
  });

  it("uses the longer length as denominator (bounded by 1)", () => {
    expect(agreementCer("ab", "xxxxxxxx")).toBeLessThanOrEqual(1);
    expect(agreementCer("", "")).toBe(0);
    expect(agreementCer("", "abc")).toBe(1);
  });
});
