/** pnpm seed:clips: migrate, then load seed/manifest.json + audio into Postgres (idempotent). */
import path from "node:path";
import { loadEnvLocal } from "./_env";

loadEnvLocal();
const { getDb } = await import("../apps/web/lib/db/index");
const { migrate } = await import("../apps/web/lib/db/migrate");
const { seedClips } = await import("../apps/web/lib/seed");

const db = getDb();
await migrate(db);
console.log("✓ migrated");
const r = await seedClips(db, path.resolve("seed"));
console.log(`✓ seed:clips loaded ${r.loaded} clip(s)`);
for (const s of r.skipped) console.log(`  • skipped ${s}`);
if (r.loaded === 0) {
  console.log(`
===== HUMAN TODO =====
No seed clips yet. Add seed/manifest.json and audio under seed/clips/<lang>/ (see BUILD_ORDER Phase 1),
or run scripts/fetch_wolof.py after checking the dataset licence. Then: pnpm seed:clips
======================`);
}
process.exit(0);
