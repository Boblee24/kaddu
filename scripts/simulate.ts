/**
 * pnpm simulate --workers 20 --honest 0.7 --lazy 0.2 --malicious 0.1
 * Runs the real scoring pipeline on in-memory Postgres with synthetic text clips and a MOCK judge.
 */
import { parseArgs } from "node:util";

process.env.AI_MOCK = "1";
const { evalClips } = await import("../apps/web/lib/evaldata");
const { simulate } = await import("../apps/web/lib/evalrun");
const { setLogSink } = await import("../packages/core/src/log");

const { values } = parseArgs({
  options: {
    workers: { type: "string", default: "20" },
    honest: { type: "string", default: "0.7" },
    lazy: { type: "string", default: "0.2" },
    malicious: { type: "string", default: "0.1" },
    seed: { type: "string", default: "42" },
  },
});
const o = {
  workers: Number(values.workers),
  honest: Number(values.honest),
  lazy: Number(values.lazy),
  malicious: Number(values.malicious),
  seed: Number(values.seed),
};
if (!Number.isInteger(o.workers) || o.workers < 1 || o.workers > 200 || Math.abs(o.honest + o.lazy + o.malicious - 1) > 1e-6) {
  console.error("✗ --workers 1..200, and --honest + --lazy + --malicious must sum to 1");
  process.exit(1);
}
setLogSink(() => {});
const r = await simulate(evalClips(), o);
console.log(`Simulation (synthetic text clips, mock judge): ${o.workers} workers, honest ${o.honest} / lazy ${o.lazy} / malicious ${o.malicious}`);
for (const [type, e] of Object.entries(r.earned)) console.log(`  ${type.padEnd(9)} ${String(e.workers).padStart(3)} workers  ${String(e.sats).padStart(6)} sats`);
console.log(`  sats to lazy + malicious workers: ${r.nonHonestSats} of ${r.totalSats}`);
console.log(`  sats leaked (paid for a WRONG transcript, CER > 0.15): ${r.leakedSats} (${(r.leakedPct * 100).toFixed(1)}%, ${r.wrongPaidCount} payouts)`);
for (const l of r.perLang) console.log(`  ${l.lang}: ${l.done}/${l.clips} done, ${l.disputed} disputed`);
process.exit(0);
