import { sql } from "drizzle-orm";
import { migratePayouts, type Db } from "@sats/payouts";
import { KADDU_SQL } from "./schema";

/** Idempotent: payouts tables, then Kàddu tables. Safe to run on every start. */
export async function migrate(db: Db): Promise<void> {
  await migratePayouts(db);
  // One statement per call: execute() runs a prepared statement, which allows only one.
  for (const stmt of KADDU_SQL.split(";").map((s) => s.trim()).filter(Boolean)) {
    await db.execute(sql.raw(stmt));
  }
}
