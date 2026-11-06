import { createClient, type Client, type InValue } from "@libsql/client";

// Local: DATABASE_URL=file:./data/proofcheck.db  (default)
// Vercel/Turso: DATABASE_URL=libsql://xxx.turso.io  DATABASE_AUTH_TOKEN=...
let client: Client | null = null;
let ready: Promise<void> | null = null;

export function db(): Client {
  if (!client) {
    // Vercel Marketplace's Turso integration injects TURSO_DATABASE_URL / TURSO_AUTH_TOKEN automatically.
    const url = process.env.DATABASE_URL || process.env.TURSO_DATABASE_URL || "file:./data/proofcheck.db";
    const authToken = process.env.DATABASE_AUTH_TOKEN || process.env.TURSO_AUTH_TOKEN;
    client = createClient({ url, authToken });
  }
  return client;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  video_id TEXT NOT NULL,
  video_title TEXT,
  channel_title TEXT,
  channel_handle TEXT,
  min_frames INTEGER NOT NULL DEFAULT 0,
  min_seconds INTEGER NOT NULL DEFAULT 0,
  keywords TEXT NOT NULL DEFAULT '',
  keyword_cursor INTEGER NOT NULL DEFAULT 0,
  instructions TEXT NOT NULL DEFAULT '',
  sg_job_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL,
  worker_ref TEXT,
  src TEXT,
  sha256 TEXT,
  sha256_2 TEXT,
  scpn TEXT,
  video_id_read TEXT,
  frames_total INTEGER,
  frames_dropped INTEGER,
  fps REAL,
  watch_seconds REAL,
  status TEXT NOT NULL,          -- pass | fail | review
  reason TEXT NOT NULL,
  payout_code TEXT,
  raw_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sub_sha ON submissions(sha256);
CREATE INDEX IF NOT EXISTS idx_sub_scpn ON submissions(scpn);
CREATE INDEX IF NOT EXISTS idx_sub_campaign ON submissions(campaign_id, created_at);
CREATE TABLE IF NOT EXISTS codes (
  code TEXT PRIMARY KEY,
  submission_id INTEGER NOT NULL,
  campaign_id INTEGER NOT NULL,
  used_at TEXT,
  sg_task_id TEXT
);
CREATE TABLE IF NOT EXISTS sg_ratings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL,
  sg_task_id TEXT NOT NULL,
  rating TEXT NOT NULL,
  code TEXT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rating_task ON sg_ratings(sg_task_id);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL,
  kind TEXT NOT NULL,            -- opened | submitted | verified | rejected
  src TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

// Additive migrations for databases created by earlier versions (errors = column already exists).
const MIGRATIONS = [
  "ALTER TABLE campaigns ADD COLUMN proof_mode TEXT NOT NULL DEFAULT 'either'",
  "ALTER TABLE submissions ADD COLUMN text_sha256 TEXT",
  "ALTER TABLE submissions ADD COLUMN source TEXT",
  "ALTER TABLE submissions ADD COLUMN played_seconds REAL",
  "CREATE INDEX IF NOT EXISTS idx_sub_text ON submissions(text_sha256)",
];

export async function ensureSchema() {
  if (!ready) {
    ready = (async () => {
      const stmts = SCHEMA.split(";").map((s) => s.trim()).filter(Boolean);
      for (const s of stmts) await db().execute(s);
      for (const m of MIGRATIONS) { try { await db().execute(m); } catch { /* already applied */ } }
    })();
  }
  return ready;
}

export async function q<T = Record<string, unknown>>(sql: string, args: InValue[] = []): Promise<T[]> {
  await ensureSchema();
  const r = await db().execute({ sql, args });
  return r.rows as unknown as T[];
}

export async function one<T = Record<string, unknown>>(sql: string, args: InValue[] = []): Promise<T | null> {
  const rows = await q<T>(sql, args);
  return rows[0] ?? null;
}

export async function run(sql: string, args: InValue[] = []) {
  await ensureSchema();
  return db().execute({ sql, args });
}

export type Campaign = {
  id: number; slug: string; name: string; video_id: string; video_title: string | null;
  channel_title: string | null; channel_handle: string | null; min_frames: number; min_seconds: number;
  keywords: string; keyword_cursor: number; instructions: string; sg_job_id: string | null;
  status: string; created_at: string; proof_mode: "either" | "screenshot" | "text" | "both";
};

export type Submission = {
  id: number; campaign_id: number; worker_ref: string | null; src: string | null; sha256: string;
  sha256_2: string | null; scpn: string | null; video_id_read: string | null; frames_total: number | null;
  frames_dropped: number | null; fps: number | null; watch_seconds: number | null; status: string;
  reason: string; payout_code: string | null; raw_json: string | null; created_at: string;
  text_sha256: string | null; source: string | null; played_seconds: number | null;
};
