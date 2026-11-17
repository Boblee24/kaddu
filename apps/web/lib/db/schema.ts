import { boolean, customType, index, integer, jsonb, pgTable, real, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { LANGS } from "./langs";
export { LANGS };
export type Lang = (typeof LANGS)[number];
export const CLIP_STATUS = ["open", "done", "disputed"] as const;
export const DECISIONS = ["pending", "accepted", "rejected"] as const;
export type Decision = (typeof DECISIONS)[number];

/** Postgres bytea. postgres-js returns a Buffer, PGlite a Uint8Array; both are Uint8Array. */
const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType: () => "bytea",
  toDriver: (v) => (Buffer.isBuffer(v) ? v : Buffer.from(v)),
  fromDriver: (v) => (v instanceof Uint8Array ? v : new Uint8Array(v as ArrayBuffer)),
});

export const clips = pgTable(
  "clips",
  {
    id: text("id").primaryKey(),
    lang: text("lang").$type<Lang>().notNull(),
    durationMs: integer("duration_ms").notNull(),
    audio: bytea("audio").notNull(),
    audioMime: text("audio_mime").notNull().default("audio/ogg"),
    /** Known transcript from seed data. NEVER sent to clients. */
    truthText: text("truth_text"),
    isGold: boolean("is_gold").notNull().default(false),
    draftText: text("draft_text").notNull().default(""),
    draftModel: text("draft_model"),
    draftConfidence: real("draft_confidence"),
    priceSats: integer("price_sats").notNull(),
    status: text("status").$type<(typeof CLIP_STATUS)[number]>().notNull().default("open"),
    consensusText: text("consensus_text"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("clips_lang_status_idx").on(t.lang, t.status)],
);

export const corrections = pgTable(
  "corrections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clipId: text("clip_id").notNull(),
    workerPubkey: text("worker_pubkey").notNull(),
    text: text("text").notNull(),
    /** UNIQUE: the replay defence. */
    eventId: text("event_id").notNull().unique(),
    sig: text("sig").notNull(),
    unchanged: boolean("unchanged").notNull().default(false),
    checks: jsonb("checks").$type<Record<string, unknown>>().notNull().default({}),
    judge: jsonb("judge").$type<Record<string, unknown> | null>(),
    decision: text("decision").$type<Decision>().notNull().default("pending"),
    rejectCode: text("reject_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("corrections_clip_worker_uq").on(t.clipId, t.workerPubkey),
    index("corrections_worker_idx").on(t.workerPubkey),
  ],
);

export const workers = pgTable("workers", {
  pubkey: text("pubkey").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  goldAttempts: integer("gold_attempts").notNull().default(0),
  goldCorrect: integer("gold_correct").notNull().default(0),
  acceptedToday: integer("accepted_today").notNull().default(0),
  /** UTC date (YYYY-MM-DD) that accepted_today counts for. */
  day: text("day").notNull().default(""),
});

export const attestations = pgTable("attestations", {
  clipId: text("clip_id").primaryKey(),
  eventId: text("event_id").notNull(),
  event: jsonb("event").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** App settings (sponsor pause switch). */
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Idempotent DDL matching the tables above. Tests run every query against it. */
export const KADDU_SQL = `
CREATE TABLE IF NOT EXISTS clips (
  id text PRIMARY KEY CHECK (id ~ '^[a-z0-9_-]{1,64}$'),
  lang text NOT NULL CHECK (lang IN ('wo','yo','pcm','ha')),
  duration_ms integer NOT NULL CHECK (duration_ms > 0),
  audio bytea NOT NULL,
  audio_mime text NOT NULL DEFAULT 'audio/ogg',
  truth_text text,
  is_gold boolean NOT NULL DEFAULT false,
  draft_text text NOT NULL DEFAULT '',
  draft_model text,
  draft_confidence real,
  price_sats integer NOT NULL CHECK (price_sats > 0),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','disputed')),
  consensus_text text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS clips_lang_status_idx ON clips (lang, status);

CREATE TABLE IF NOT EXISTS corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clip_id text NOT NULL REFERENCES clips(id) ON DELETE CASCADE,
  worker_pubkey text NOT NULL CHECK (worker_pubkey ~ '^[0-9a-f]{64}$'),
  text text NOT NULL CHECK (char_length(text) <= 500),
  event_id text NOT NULL UNIQUE,
  sig text NOT NULL,
  unchanged boolean NOT NULL DEFAULT false,
  checks jsonb NOT NULL DEFAULT '{}'::jsonb,
  judge jsonb,
  decision text NOT NULL DEFAULT 'pending' CHECK (decision IN ('pending','accepted','rejected')),
  reject_code text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS corrections_clip_worker_uq ON corrections (clip_id, worker_pubkey);
CREATE INDEX IF NOT EXISTS corrections_worker_idx ON corrections (worker_pubkey);

CREATE TABLE IF NOT EXISTS workers (
  pubkey text PRIMARY KEY CHECK (pubkey ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  gold_attempts integer NOT NULL DEFAULT 0,
  gold_correct integer NOT NULL DEFAULT 0,
  accepted_today integer NOT NULL DEFAULT 0,
  day text NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS settings (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS attestations (
  clip_id text PRIMARY KEY REFERENCES clips(id) ON DELETE CASCADE,
  event_id text NOT NULL,
  event jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
`;
