import { createClient, type Client, type InValue } from "@libsql/client";
import { applySchema } from "./schema.mjs";

// Local: DATABASE_URL=file:./data/proofcheck.db  (default)
// Vercel/Turso: DATABASE_URL=libsql://xxx.turso.io  DATABASE_AUTH_TOKEN=...
let client: Client | null = null;
let ready: Promise<void> | null = null;

export function db(): Client {
  if (!client) {
    // Vercel Marketplace's Turso integration injects TURSO_DATABASE_URL / TURSO_AUTH_TOKEN automatically.
    const url = process.env.DATABASE_URL || process.env.TURSO_DATABASE_URL || defaultFileUrl();
    const authToken = process.env.DATABASE_AUTH_TOKEN || process.env.TURSO_AUTH_TOKEN;
    client = createClient({ url, authToken });
  }
  return client;
}

// On Vercel/Lambda the project dir is read-only; /tmp is writable but ephemeral (data lost on cold start).
function defaultFileUrl() {
  return process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME ? "file:/tmp/proofcheck.db" : "file:./data/proofcheck.db";
}

/** True when no persistent database is configured (ephemeral /tmp fallback in use). */
export function dbIsEphemeral() {
  return !process.env.DATABASE_URL && !process.env.TURSO_DATABASE_URL && !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
}

/** Which backend is in use, for diagnostics (never includes secrets). */
export function dbInfo() {
  const url = process.env.DATABASE_URL || process.env.TURSO_DATABASE_URL || defaultFileUrl();
  return { backend: url.startsWith("file:") ? "sqlite-file" : "libsql-remote", host: url.startsWith("file:") ? url : new URL(url).host, ephemeral: dbIsEphemeral() };
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
  status: string; created_at: string; proof_mode: "either" | "screenshot" | "text" | "both";
};

export type Submission = {
  id: number; campaign_id: number; worker_ref: string | null; src: string | null; sha256: string;
  sha256_2: string | null; scpn: string | null; video_id_read: string | null; frames_total: number | null;
  frames_dropped: number | null; fps: number | null; watch_seconds: number | null; status: string;
  reason: string; payout_code: string | null; raw_json: string | null; created_at: string;
  text_sha256: string | null; source: string | null; played_seconds: number | null;
};
