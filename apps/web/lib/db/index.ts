import { requireEnv } from "@sats/core/env";
import { createDb } from "@sats/payouts/db";
import type { Db } from "@sats/payouts";

export type { Db };
let db: Db | undefined;

/** Shared Postgres client for route handlers (lazy, one per server instance). */
export function getDb(): Db {
  db ??= createDb(requireEnv("DATABASE_URL")) as unknown as Db;
  return db;
}
