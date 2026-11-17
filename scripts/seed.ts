/**
 * pnpm seed: everything the demo needs (idempotent; `pnpm demo` runs it on every start).
 * Kàddu: migrate + clips (+ drafts from seed/drafts.json). Personas are added in Phase 2.
 */
import { spawnSync } from "node:child_process";

const r = spawnSync("pnpm", ["exec", "tsx", "scripts/seed-clips.ts"], { stdio: "inherit", shell: process.platform === "win32" });
process.exit(r.status ?? 1);
