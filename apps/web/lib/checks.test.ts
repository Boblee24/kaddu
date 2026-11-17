import { describe, expect, it } from "vitest";
import { deterministicChecks, isCopyOf } from "./checks";
import { findConsensus } from "./consensus";

const base = { draft: "naka nga def", durationMs: 4000 };

describe("deterministicChecks", () => {
  it("passes a normal correction and flags unchanged paste-backs", () => {
    expect(deterministicChecks({ ...base, text: "Naka nga def? Ñaata la?" })).toMatchObject({ unchanged: false, hard: [] });
    expect(deterministicChecks({ ...base, text: "Naka nga def!" })).toMatchObject({ unchanged: true, hard: [] });
  });

  it("accepts Yoruba tone marks and Hausa hooked letters", () => {
    expect(deterministicChecks({ ...base, text: "Ẹ káàbọ̀, ṣé dáadáa ni?" }).hard).toEqual([]);
    expect(deterministicChecks({ ...base, text: "Ina ɗan'uwanka? ƙasa" }).hard).toEqual([]);
  });

  it("flags empty, too short/long for the audio, digits only", () => {
    expect(deterministicChecks({ ...base, text: "  ?! " }).hard).toEqual(["empty"]);
    expect(deterministicChecks({ ...base, text: "ok" }).hard).toContain("implausible_length");
    expect(deterministicChecks({ ...base, text: "a".repeat(150) }).hard).toContain("implausible_length");
    expect(deterministicChecks({ ...base, text: "12345678 9012" }).hard).toContain("digits_only");
  });

  it("flags URLs, emoji and non-Latin scripts", () => {
    expect(deterministicChecks({ ...base, text: "visit www.spam.com now" }).hard).toContain("url");
    expect(deterministicChecks({ ...base, text: "naka nga def 😂😂" }).hard).toContain("emoji");
    expect(deterministicChecks({ ...base, text: "نكا نغا ديف" }).hard).toContain("wrong_script");
  });
});

describe("isCopyOf", () => {
  it("matches another clip's consensus ignoring case, punctuation and diacritics", () => {
    expect(isCopyOf("Jërëjëf!", ["jerejef", "other"])).toBe(true);
    expect(isCopyOf("jerejef waay", ["jerejef"])).toBe(false);
    expect(isCopyOf("", [""])).toBe(false);
  });
});

describe("findConsensus", () => {
  const c = (id: string, text: string) => ({ id, text });

  it("3 agree → all accepted, medoid chosen", () => {
    const r = findConsensus([c("a", "maa ngi fi rekk"), c("b", "maa ngi fi rek"), c("c", "Maa ngi fi rekk.")]);
    expect(r).toMatchObject({ kind: "agreed", consensusText: "maa ngi fi rekk", rejected: [] });
    if (r.kind === "agreed") expect(r.accepted.sort()).toEqual(["a", "b", "c"]);
  });

  it("2 agree, 1 lazy paste-back of a wrong draft → paste-back rejected", () => {
    const r = findConsensus([c("truth", "maa ngi fi rekk jerejef"), c("typo", "maa ngi fi rek jerejef"), c("lazy", "ma ngi fii")]);
    expect(r).toMatchObject({ kind: "agreed", rejected: ["lazy"] });
  });

  it("no two agree → disputed", () => {
    expect(findConsensus([c("a", "naka nga def"), c("b", "jerejef waay"), c("c", "ba beneen yoon")])).toEqual({ kind: "disputed" });
  });

  it("is diacritic-insensitive (tone marks typed inconsistently)", () => {
    const r = findConsensus([c("a", "Ẹ káàbọ̀ o"), c("b", "e kaabo o"), c("c", "something else entirely")]);
    expect(r).toMatchObject({ kind: "agreed", rejected: ["c"] });
  });
});
