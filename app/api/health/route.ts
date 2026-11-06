import { NextResponse } from "next/server";
import { q, dbInfo } from "@/lib/db";

export const dynamic = "force-dynamic";

// Diagnostics: which integrations are configured (names only) and whether the DB answers.
export async function GET() {
  const has = (k: string) => !!process.env[k];
  const env = {
    ADMIN_PASSWORD: has("ADMIN_PASSWORD"), CRON_SECRET: has("CRON_SECRET"), GEMINI_API_KEY: has("GEMINI_API_KEY"),
    SG_USER_ID: has("SG_USER_ID"), SG_API_SECRET: has("SG_API_SECRET"), YOUTUBE_API_KEY: has("YOUTUBE_API_KEY"),
    DATABASE_URL: has("DATABASE_URL"), TURSO_DATABASE_URL: has("TURSO_DATABASE_URL"), TURSO_AUTH_TOKEN: has("TURSO_AUTH_TOKEN"),
    // other marketplace DBs people pick by mistake — present means "wrong kind of database for this app"
    POSTGRES_URL: has("POSTGRES_URL"), DATABASE_URL_UNPOOLED: has("DATABASE_URL_UNPOOLED"), KV_REST_API_URL: has("KV_REST_API_URL"), UPSTASH_REDIS_REST_URL: has("UPSTASH_REDIS_REST_URL"),
  };
  let db: { ok: boolean; campaigns?: number; error?: string } = { ok: false };
  try { const r = await q<{ n: number }>("SELECT COUNT(*) n FROM campaigns"); db = { ok: true, campaigns: Number(r[0]?.n ?? 0) }; }
  catch (e) { db = { ok: false, error: String(e).slice(0, 300) }; }
  const info = dbInfo();
  const warnings: string[] = [];
  if (info.ephemeral) warnings.push("No persistent database configured: using /tmp SQLite, data is lost on every cold start. Connect Turso (Storage tab) or set DATABASE_URL.");
  if (env.POSTGRES_URL && !env.TURSO_DATABASE_URL && !env.DATABASE_URL?.valueOf()) warnings.push("A Postgres database is attached but this app uses libSQL/Turso. Remove it and add Turso instead.");
  if (!env.ADMIN_PASSWORD) warnings.push("ADMIN_PASSWORD is not set; admin login is impossible.");
  if (!env.GEMINI_API_KEY) warnings.push("GEMINI_API_KEY not set: screenshot proof goes to manual review; text proof works.");
  return NextResponse.json({ ok: db.ok, db: { ...info, ...db }, env, warnings, vercel: !!process.env.VERCEL, region: process.env.VERCEL_REGION ?? null, at: new Date().toISOString() });
}
