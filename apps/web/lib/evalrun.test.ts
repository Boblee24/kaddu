import { describe, expect, it } from "vitest";
import { setLogSink } from "@sats/core/log";
import { evalClips, fraudCases } from "./evaldata";
import { fraudEval, redTeam } from "./evalrun";

setLogSink(() => {});

// Runs the whole pipeline many times on PGlite: slow under parallel test load.
describe("eval (synthetic data, mock judge)", { timeout: 180_000 }, () => {
  it("fraud.json has 30 bad and 50 good cases; no good case is flagged", async () => {
    const clips = evalClips();
    const cases = fraudCases(clips);
    expect(cases.filter((c) => c.label === "bad")).toHaveLength(30);
    expect(cases.filter((c) => c.label === "good")).toHaveLength(50);
    const r = await fraudEval(clips, cases);
    expect(r.withJudge.fp).toBe(0);
    expect(r.withJudge.recall).toBeGreaterThanOrEqual(r.deterministic.recall);
  });

  it("every red-team case behaves as expected", async () => {
    const rt = await redTeam(evalClips());
    expect(rt.filter((r) => !r.pass)).toEqual([]);
  });
});
