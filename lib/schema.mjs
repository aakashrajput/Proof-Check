// Single source of truth for the database schema.
// Used by lib/db.ts at runtime (auto-apply on first query) and by scripts/migrate.mjs at deploy time.
// Rules: every statement must be idempotent. Add new columns to MIGRATIONS (ALTER TABLE … ADD COLUMN) and
// also to the CREATE TABLE so fresh databases and old databases converge on the same shape.

export const SCHEMA_VERSION = 7;

export const SCHEMA = [
`CREATE TABLE IF NOT EXISTS campaigns (
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
  proof_mode TEXT NOT NULL DEFAULT 'either',
  owner_id INTEGER,
  duration_seconds INTEGER,
  thumbnail_url TEXT,
  attest TEXT NOT NULL DEFAULT 'like,subscribe,comment',
  show_instructions INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`,
`CREATE TABLE IF NOT EXISTS campaign_variants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL,
  label TEXT NOT NULL,            -- A | B | C
  title TEXT NOT NULL,
  thumb_url TEXT,                 -- YouTube thumbnail URL (default variant)
  thumb_data TEXT,                -- data:image/jpeg;base64,… uploaded by the employer (resized client-side)
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`,
`CREATE INDEX IF NOT EXISTS idx_variants_campaign ON campaign_variants(campaign_id, position)`,
`CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT,
  sg_user_id TEXT,
  sg_secret_enc TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`,
`CREATE INDEX IF NOT EXISTS idx_campaigns_owner ON campaigns(owner_id)`,
`CREATE TABLE IF NOT EXISTS submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL,
  worker_ref TEXT,
  src TEXT,
  sha256 TEXT,
  sha256_2 TEXT,
  text_sha256 TEXT,
  source TEXT,
  scpn TEXT,
  video_id_read TEXT,
  frames_total INTEGER,
  frames_dropped INTEGER,
  fps REAL,
  watch_seconds REAL,
  played_seconds REAL,
  status TEXT NOT NULL,
  reason TEXT NOT NULL,
  payout_code TEXT,
  raw_json TEXT,
  variant_id INTEGER,
  attested TEXT,
  attempts INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`,
`CREATE INDEX IF NOT EXISTS idx_sub_sha ON submissions(sha256)`,
`CREATE INDEX IF NOT EXISTS idx_sub_text ON submissions(text_sha256)`,
`CREATE INDEX IF NOT EXISTS idx_sub_scpn ON submissions(scpn)`,
`CREATE INDEX IF NOT EXISTS idx_sub_campaign ON submissions(campaign_id, created_at)`,
`CREATE TABLE IF NOT EXISTS codes (
  code TEXT PRIMARY KEY,
  submission_id INTEGER NOT NULL,
  campaign_id INTEGER NOT NULL,
  used_at TEXT,
  sg_task_id TEXT
)`,
`CREATE TABLE IF NOT EXISTS sg_ratings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL,
  sg_task_id TEXT NOT NULL,
  rating TEXT NOT NULL,
  code TEXT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`,
`CREATE UNIQUE INDEX IF NOT EXISTS idx_rating_task ON sg_ratings(sg_task_id)`,
`CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  src TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`,
`CREATE INDEX IF NOT EXISTS idx_events_campaign ON events(campaign_id, kind)`,
`CREATE TABLE IF NOT EXISTS schema_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
)`,
];

// Additive column migrations for databases created by earlier versions.
// Each is [table, column, definition]; applied only when the column is missing.
export const COLUMNS = [
  ["campaigns", "proof_mode", "TEXT NOT NULL DEFAULT 'either'"],
  ["submissions", "text_sha256", "TEXT"],
  ["submissions", "source", "TEXT"],
  ["submissions", "played_seconds", "REAL"],
  ["campaigns", "owner_id", "INTEGER"],
  ["campaigns", "duration_seconds", "INTEGER"],
  ["campaigns", "thumbnail_url", "TEXT"],
  ["submissions", "variant_id", "INTEGER"],
  ["campaigns", "attest", "TEXT NOT NULL DEFAULT 'like,subscribe,comment'"],
  ["submissions", "attested", "TEXT"],
  ["campaigns", "show_instructions", "INTEGER NOT NULL DEFAULT 1"],
  ["submissions", "attempts", "INTEGER NOT NULL DEFAULT 1"],
  ["submissions", "updated_at", "TEXT"],
];

/**
 * Apply the schema idempotently with any libsql client. Returns a report.
 * @param {{execute: (sql: string | {sql: string, args?: unknown[]}) => Promise<any>}} client
 */
export async function applySchema(client) {
  const report = { created: 0, columnsAdded: [], version: SCHEMA_VERSION };
  // 1. tables (no-op where they exist)  2. add missing columns to legacy tables  3. indexes (which may reference new columns)
  const tables = SCHEMA.filter((s) => s.startsWith("CREATE TABLE"));
  const rest = SCHEMA.filter((s) => !s.startsWith("CREATE TABLE"));
  for (const sql of tables) { await client.execute(sql); report.created++; }
  for (const [table, col, def] of COLUMNS) {
    const info = await client.execute(`PRAGMA table_info(${table})`);
    const have = new Set(info.rows.map((r) => String(r.name)));
    if (!have.has(col)) { await client.execute(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`); report.columnsAdded.push(`${table}.${col}`); }
  }
  for (const sql of rest) { await client.execute(sql); report.created++; }
  await client.execute({ sql: "INSERT INTO schema_meta (key, value) VALUES ('version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", args: [String(SCHEMA_VERSION)] });
  await client.execute({ sql: "INSERT INTO schema_meta (key, value) VALUES ('migrated_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", args: [new Date().toISOString()] });
  return report;
}
