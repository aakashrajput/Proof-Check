import { createClient, type Client, type InValue } from "@libsql/client";
import { applySchema } from "./schema.mjs";

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

/** Env var names that look database-related (names only, never values) — for /api/health. */
export function dbEnvNames() {
  return Object.keys(process.env).filter((k) => /TURSO|LIBSQL|DATABASE|POSTGRES|NEON|SUPABASE|UPSTASH|KV_|REDIS|MONGO|PLANETSCALE|_URL$|TOKEN$/i.test(k) && !/^(VERCEL_|NEXT_|NODE_|npm_|AWS_)/.test(k)).sort();
}

/** Which backend is in use, for diagnostics (never includes secrets). */
export function dbInfo() {
  const { url, authToken, source } = resolveDb();
  let host = url; try { if (!url.startsWith("file:")) host = new URL(url).host; } catch { /* keep raw */ }
  return { backend: url.startsWith("file:") ? "sqlite-file" : "libsql-remote", host, source, hasToken: !!authToken, ephemeral: dbIsEphemeral() };
}



export async function ensureSchema() {
  if (!ready) {
    ready = applySchema(db()).then(() => undefined).catch((e) => { ready = null; throw e; });
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
  status: string; created_at: string; proof_mode: "either" | "screenshot" | "text" | "both"; owner_id: number | null;
  duration_seconds: number | null; thumbnail_url: string | null;
};

export type Variant = { id: number; campaign_id: number; label: string; title: string; thumb_url: string | null; thumb_data: string | null; position: number };

export type User = { id: number; email: string; password_hash: string; name: string | null; sg_user_id: string | null; sg_secret_enc: string | null; created_at: string };

export type Submission = {
  id: number; campaign_id: number; worker_ref: string | null; src: string | null; sha256: string;
  sha256_2: string | null; scpn: string | null; video_id_read: string | null; frames_total: number | null;
  frames_dropped: number | null; fps: number | null; watch_seconds: number | null; status: string;
  reason: string; payout_code: string | null; raw_json: string | null; created_at: string;
  text_sha256: string | null; source: string | null; played_seconds: number | null; variant_id: number | null;
};
