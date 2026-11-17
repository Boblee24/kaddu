/**
 * pnpm seed: everything the demo needs (idempotent; `pnpm demo` runs it on every start).
 * Kàddu: migrate + clips (+ drafts from seed/drafts.json), then personas pre-submit.
 */
import { spawnSync } from "node:child_process";

for (const script of ["scripts/seed-clips.ts", "scripts/personas.ts"]) {
  const r = spawnSync("pnpm", ["exec", "tsx", script], { stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
