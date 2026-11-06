import { createClient, type Client, type InValue } from "@libsql/client";
import { applySchema, SCHEMA_VERSION } from "./schema.mjs";

// Local: DATABASE_URL=file:./data/proofcheck.db  (default)
// Vercel/Turso: DATABASE_URL=libsql://xxx.turso.io  DATABASE_AUTH_TOKEN=...
let client: Client | null = null;
let ready: Promise<void> | null = null;

export function db(): Client {
  if (!client) {
    // Vercel Marketplace's Turso integration injects TURSO_DATABASE_URL / TURSO_AUTH_TOKEN automatically.
    const { url, authToken } = resolveDb();
    client = createClient({ url, authToken });
  }
  return client;
}

// On Vercel/Lambda the project dir is read-only; /tmp is writable but ephemeral (data lost on cold start).
function defaultFileUrl() {
  return process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME ? "file:/tmp/proofcheck.db" : "file:./data/proofcheck.db";
}

/**
 * Resolve the database connection. Order:
 *  1. DATABASE_URL (+ DATABASE_AUTH_TOKEN)
 *  2. TURSO_DATABASE_URL (+ TURSO_AUTH_TOKEN)
 *  3. any env var whose value is a libsql:// or *.turso.io URL (marketplace integrations use their own prefixes),
 *     paired with a token var sharing its prefix (…AUTH_TOKEN / …TOKEN)
 *  4. local file (ephemeral /tmp on Vercel)
 */
export function resolveDb(): { url: string; authToken?: string; source: string } {
  const e = process.env;
  if (e.DATABASE_URL) return { url: e.DATABASE_URL, authToken: e.DATABASE_AUTH_TOKEN || e.TURSO_AUTH_TOKEN, source: "DATABASE_URL" };
  if (e.TURSO_DATABASE_URL) return { url: e.TURSO_DATABASE_URL, authToken: e.TURSO_AUTH_TOKEN, source: "TURSO_DATABASE_URL" };
  for (const [k, v] of Object.entries(e)) {
    if (!v || !/^(libsql:\/\/|https?:\/\/[^/]*\.turso\.io|wss?:\/\/[^/]*\.turso\.io)/i.test(v)) continue;
    const prefix = k.replace(/(DATABASE_|DB_)?URL$/i, "");
    const token = e[prefix + "AUTH_TOKEN"] || e[prefix + "DATABASE_AUTH_TOKEN"] || e[prefix + "DB_AUTH_TOKEN"] || e[prefix + "TOKEN"] || e[prefix + "DATABASE_TOKEN"]
      || Object.entries(e).find(([kk, vv]) => kk.startsWith(prefix) && /TOKEN/i.test(kk) && !!vv)?.[1];
    return { url: v, authToken: token, source: k };
  }
  return { url: defaultFileUrl(), source: "file" };
}

/** True when no persistent database is configured (ephemeral /tmp fallback in use). */
export function dbIsEphemeral() {
  return resolveDb().url.startsWith("file:/tmp/");
}

/**
 * True when the Turso *marketplace integration* handed us a per-deployment database (hostname starts with "dpl-").
 * Such a database is recreated empty on every deploy, so accounts and campaigns vanish. Fix: set DATABASE_URL +
 * DATABASE_AUTH_TOKEN to a fixed Turso database; they take precedence.
 */
export function dbIsPerDeployment() {
  const { url, source } = resolveDb();
  if (source === "DATABASE_URL") return false;
  try { return /^dpl-/i.test(new URL(url).host); } catch { return false; }
}

/** Human-readable persistence warning, or null when the database is fine. */
export function dbPersistenceWarning(): string | null {
  if (dbIsEphemeral()) return "No persistent database configured: using temporary storage, data is lost on every cold start. Set DATABASE_URL + DATABASE_AUTH_TOKEN to a Turso database.";
  if (dbIsPerDeployment()) return "The Turso integration is providing a PER-DEPLOYMENT database (hostname starts with dpl-). Every deploy starts empty: accounts and campaigns are lost. Create a fixed database at turso.tech and set DATABASE_URL + DATABASE_AUTH_TOKEN in Vercel (they override the integration).";
  return null;
}

/** Env var names that look database-related (names only, never values) — for /api/health. */
export function dbEnvNames() {
  return Object.keys(process.env).filter((k) => /TURSO|LIBSQL|DATABASE|POSTGRES|NEON|SUPABASE|UPSTASH|KV_|REDIS|MONGO|PLANETSCALE|_URL$|TOKEN$/i.test(k) && !/^(VERCEL_|NEXT_|NODE_|npm_|AWS_)/.test(k)).sort();
}

/** Which backend is in use, for diagnostics (never includes secrets). */
/** Never echo secrets: a value that isn't a parseable URL could be a token pasted in the wrong field. */
function safeHost(url: string): string {
  if (url.startsWith("file:")) return url;
  try { const h = new URL(url).host; if (h && h.includes(".")) return h; } catch { /* fall through */ }
  if (/^eyJ/.test(url)) return "[invalid: value looks like an auth token — URL and token are swapped]";
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) return `[invalid: no libsql:// scheme, starts with "${url.slice(0, 8)}…"]`;
  return "[invalid URL]";
}

export function dbInfo() {
  const { url, authToken, source } = resolveDb();
  const host = safeHost(url);
  return { backend: url.startsWith("file:") ? "sqlite-file" : "libsql-remote", host, source, hasToken: !!authToken, ephemeral: dbIsEphemeral(), perDeployment: dbIsPerDeployment(), persistent: !dbIsEphemeral() && !dbIsPerDeployment() };
}



export async function ensureSchema() {
  if (!ready) {
    ready = (async () => {
      const t0 = Date.now();
      try {
        const r = await db().execute("SELECT value FROM schema_meta WHERE key = 'version'");
        if (Number(r.rows[0]?.value) === SCHEMA_VERSION) { if (process.env.DB_DEBUG) console.log(`[db] schema v${SCHEMA_VERSION} ok (${Date.now() - t0}ms)`); return; }
      } catch { /* table missing → full apply */ }
      await applySchema(db());
      console.log(`[db] schema applied → v${SCHEMA_VERSION} (${Date.now() - t0}ms)`);
    })().catch((e) => { ready = null; throw e; });
  }
  return ready;
}

export async function q<T = Record<string, unknown>>(sql: string, args: InValue[] = []): Promise<T[]> {
  await ensureSchema();
  const t0 = Date.now();
  const r = await db().execute({ sql, args });
  if (process.env.DB_DEBUG || Date.now() - t0 > 1500) console.log(`[db] ${Date.now() - t0}ms ${sql.slice(0, 70).replace(/\s+/g, " ")}`);
  return r.rows as unknown as T[];
}

export async function one<T = Record<string, unknown>>(sql: string, args: InValue[] = []): Promise<T | null> {
  const rows = await q<T>(sql, args);
  return rows[0] ?? null;
}

export async function run(sql: string, args: InValue[] = []) {
  await ensureSchema();
  const t0 = Date.now();
  const r = await db().execute({ sql, args });
  if (process.env.DB_DEBUG || Date.now() - t0 > 1500) console.log(`[db] ${Date.now() - t0}ms ${sql.slice(0, 70).replace(/\s+/g, " ")}`);
  return r;
}

export type Campaign = {
  id: number; slug: string; name: string; video_id: string; video_title: string | null;
  channel_title: string | null; channel_handle: string | null; min_frames: number; min_seconds: number;
  keywords: string; keyword_cursor: number; instructions: string; sg_job_id: string | null;
  status: string; created_at: string; proof_mode: "either" | "screenshot" | "text" | "both"; owner_id: number | null;
  duration_seconds: number | null; thumbnail_url: string | null; attest: string;
};

export const ATTEST_OPTIONS = [
  { key: "like", label: "I liked the video", hint: "Tap 👍 under the video" },
  { key: "subscribe", label: "I subscribed to the channel", hint: "The button shows “Subscribed”" },
  { key: "comment", label: "I left a relevant comment", hint: "About the video’s topic — not just “nice video”" },
] as const;
export type AttestKey = (typeof ATTEST_OPTIONS)[number]["key"];
export function parseAttest(s: string | null | undefined): AttestKey[] {
  const allowed = new Set(ATTEST_OPTIONS.map((o) => o.key));
  return (s ?? "").split(",").map((x) => x.trim()).filter((x): x is AttestKey => allowed.has(x as AttestKey));
}

export type Variant = { id: number; campaign_id: number; label: string; title: string; thumb_url: string | null; thumb_data: string | null; position: number };

export type User = { id: number; email: string; password_hash: string; name: string | null; sg_user_id: string | null; sg_secret_enc: string | null; created_at: string };

export type Submission = {
  id: number; campaign_id: number; worker_ref: string | null; src: string | null; sha256: string;
  sha256_2: string | null; scpn: string | null; video_id_read: string | null; frames_total: number | null;
  frames_dropped: number | null; fps: number | null; watch_seconds: number | null; status: string;
  reason: string; payout_code: string | null; raw_json: string | null; created_at: string;
  text_sha256: string | null; source: string | null; played_seconds: number | null; variant_id: number | null; attested: string | null;
};
