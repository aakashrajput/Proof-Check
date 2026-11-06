#!/usr/bin/env node
// Applies the schema (lib/schema.mjs) to the configured database. Idempotent; safe to run on every deploy.
//
//   node scripts/migrate.mjs            # uses DATABASE_URL / TURSO_DATABASE_URL (+ auth token), else local file
//   npm run migrate
//
// On Vercel this runs as part of `npm run build` (see package.json). If no remote DB is configured at build
// time it prints a warning and exits 0, so a missing Turso never breaks a deploy; the app then applies the
// schema itself on first request.
import { createClient } from "@libsql/client";
import { applySchema, SCHEMA_VERSION } from "../lib/schema.mjs";

const url = process.env.DATABASE_URL || process.env.TURSO_DATABASE_URL;
const authToken = process.env.DATABASE_AUTH_TOKEN || process.env.TURSO_AUTH_TOKEN;
const onVercel = !!process.env.VERCEL;
const strict = process.argv.includes("--strict");

if (!url) {
  if (onVercel) {
    console.warn("[migrate] No DATABASE_URL / TURSO_DATABASE_URL set on Vercel — skipping. Attach Turso under Storage and redeploy; until then the app uses ephemeral /tmp storage.");
    process.exit(strict ? 1 : 0);
  }
  console.log("[migrate] No remote DB configured; migrating local file ./data/proofcheck.db");
}

const target = url || "file:./data/proofcheck.db";
const client = createClient({ url: target, authToken });
try {
  const t0 = Date.now();
  const rep = await applySchema(client);
  const host = target.startsWith("file:") ? target : new URL(target).host;
  console.log(`[migrate] ok → ${host} · schema v${rep.version} · ${rep.created} statements · columns added: ${rep.columnsAdded.length ? rep.columnsAdded.join(", ") : "none"} · ${Date.now() - t0}ms`);
} catch (e) {
  console.error("[migrate] FAILED:", e.message ?? e);
  process.exit(1);
}
