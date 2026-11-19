/**
 * pnpm checkpoint [--base http://localhost:3010] [--lang wo]
 *
 * End-to-end check of the live-worker flow without a phone, over the app's real HTTP API:
 *   1. a fresh worker key qualifies on 2 gold clips (answers taken from truth_text: this is a test
 *      harness standing in for a speaker who knows the language),
 *   2. it submits the 3rd correction on a clip the personas already primed, so consensus forms,
 *   3. it claims its sats into the NWC_LIVE_WORKER wallet via /api/claim (paid by SPONSOR_NWC_URL),
 *   4. it confirms on the worker's own wallet that the invoice settled.
 * The server at --base must use the same DATABASE_URL as this script (it reads clip ids from it).
 * Prints ids, amounts and statuses only: never keys, NWC strings or transcripts.
 */
import { parseArgs } from "node:util";
import { connectWallet } from "@sats/lightning";
import { loadEnvLocal } from "./_env";

loadEnvLocal();
const { values } = parseArgs({ options: { base: { type: "string", default: "http://localhost:3010" }, lang: { type: "string", default: "wo" } } });
const BASE = values.base!.replace(/\/$/, "");
const LANG = values.lang!;

const { getDb } = await import("../apps/web/lib/db/index");
const { newWorker, goldClips, primedClip } = await import("../apps/web/lib/checkpoint");
const { KIND_CORRECTION, KIND_CLAIM } = await import("../apps/web/lib/protocol");
const db = getDb();

const LANG_T = LANG as "wo" | "yo" | "pcm" | "ha";
const { pubkey, sign } = newWorker();
const step = (s: string) => console.log(`\n▸ ${s}`);
const fail = (s: string): never => {
  console.log(`✗ ${s}`);
  process.exit(1);
};

async function post(path: string, event: unknown) {
  const res = await fetch(`${BASE}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ event }) });
  return (await res.json()) as Record<string, unknown>;
}
async function correct(clipId: string, text: string) {
  const ev = sign({ kind: KIND_CORRECTION, content: JSON.stringify({ clip_id: clipId, text }), tags: [["clip", clipId]] });
  return post("/api/corrections", ev);
}

console.log(`Checkpoint against ${BASE} (lang ${LANG}), fresh worker ${pubkey.slice(0, 12)}…`);
const health = await fetch(`${BASE}/api/health`).then((r) => r.ok, () => false);
if (!health) fail(`server not reachable at ${BASE}`);

step("1. Qualify on 2 gold clips");
const gold = await goldClips(db, LANG_T, 2);
if (gold.length < 2) fail("fewer than 2 gold clips in this language");
for (const g of gold) {
  const r = await correct(g.id, g.truth!);
  console.log(`  ${g.id}: ${r.decision ?? r.code}${r.sats ? ` +${r.sats} sats` : ""}`);
}

step("2. Third correction on a persona-primed clip");
const clip = (await primedClip(db, LANG_T)) ?? fail("no persona-primed clip left (run `pnpm personas`)");
const r3 = await correct(clip.id, clip.truth);
console.log(`  ${clip.id}: decision=${r3.decision ?? r3.code} consensus=${r3.consensus ?? false} sats=${r3.sats ?? 0}`);
if (r3.attestationId) console.log(`  attestation event ${r3.attestationId}`);
if (r3.decision !== "accepted" || !r3.consensus) fail("consensus did not form");

step("3. Claim into the live-worker wallet");
const bal = (await (await fetch(`${BASE}/api/balance?pubkey=${pubkey}`)).json()) as { claimable?: number };
const claimable = bal.claimable ?? 0;
console.log(`  claimable: ${claimable} sats`);
if (claimable <= 0) fail("nothing to claim");
const url = process.env.NWC_LIVE_WORKER ?? fail("NWC_LIVE_WORKER is not set in .env.local");
const { wallet, attempts } = await connectWallet(url);
console.log(`  worker wallet connected (attempts: ${attempts})`);
try {
  const before = await wallet.balanceSats().catch(() => null);
  const inv = await wallet.makeInvoice({ sats: claimable, memo: "Kàddu checkpoint", expirySec: 600 });
  const claimEv = sign({ kind: KIND_CLAIM, content: inv.bolt11, tags: [["t", "kaddu-claim"]] });
  const c = await post("/api/claim", claimEv);
  console.log(`  /api/claim → status=${c.status}${c.code ? ` code=${c.code}` : ""}${c.sats ? ` sats=${c.sats}` : ""}`);
  if (c.status === "rejected") fail("claim rejected");

  step("4. Confirm on the worker's wallet");
  let settled = false;
  for (let i = 0; i < 15 && !settled; i++) {
    settled = (await wallet.lookupInvoice(inv.paymentHash).catch(() => ({ settled: false }))).settled;
    if (!settled) await new Promise((r) => setTimeout(r, 2000));
  }
  const after = await wallet.balanceSats().catch(() => null);
  console.log(`  invoice ${inv.paymentHash.slice(0, 16)}… settled=${settled}`);
  if (before !== null && after !== null) console.log(`  worker wallet balance: ${before} → ${after} sats`);
  if (!settled) fail("payment not seen on the worker wallet within 30 s");
  console.log(`\n✓ checkpoint passed: consensus formed and ${claimable} sats reached the live-worker wallet.`);
} finally {
  wallet.close();
}
process.exit(0);
