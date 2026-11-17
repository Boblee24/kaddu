/**
 * pnpm personas: 3 scripted personas pre-submit 2 corrections per open non-gold clip (idempotent).
 * Persona keys are generated into .env.local on first run (PERSONA1_NSEC..PERSONA3_NSEC), never printed.
 * Their payouts accrue to those keys; connecting faucet wallets persona1-3 to claim is optional.
 */
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { ENV_LOCAL, loadEnvLocal } from "./_env";

if (!existsSync(ENV_LOCAL)) {
  console.error("✗ no .env.local: run `pnpm demo --no-start` first");
  process.exit(1);
}
let env = readFileSync(ENV_LOCAL, "utf8");
for (const k of ["PERSONA1_NSEC", "PERSONA2_NSEC", "PERSONA3_NSEC"]) {
  if (!new RegExp(`^${k}=\\S+`, "m").test(env)) env = `${env.trimEnd()}\n${k}=${randomBytes(32).toString("hex")}\n`;
}
writeFileSync(ENV_LOCAL, env, { mode: 0o600 });
loadEnvLocal();

const { getDb } = await import("../apps/web/lib/db/index");
const { runPersonas } = await import("../apps/web/lib/personas");
const nsecs = [process.env.PERSONA1_NSEC!, process.env.PERSONA2_NSEC!, process.env.PERSONA3_NSEC!] as [string, string, string];
const s = await runPersonas(getDb(), nsecs, { serverNsec: process.env.SERVER_NOSTR_NSEC || undefined });
console.log(`✓ personas: ${s.qualified} qualification answers, ${s.presubmitted} pre-submissions on ${s.clips} clip(s)`);
process.exit(0);
