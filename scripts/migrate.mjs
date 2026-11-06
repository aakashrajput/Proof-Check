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

let url = process.env.DATABASE_URL || process.env.TURSO_DATABASE_URL;
let authToken = process.env.DATABASE_AUTH_TOKEN || process.env.TURSO_AUTH_TOKEN;
if (!url) {
  // Marketplace integrations may use their own prefix: find any libsql / turso URL and a token sharing its prefix.
  for (const [k, v] of Object.entries(process.env)) {
    if (!v || !/^(libsql:\/\/|https?:\/\/[^/]*\.turso\.io|wss?:\/\/[^/]*\.turso\.io)/i.test(v)) continue;
    const prefix = k.replace(/(DATABASE_|DB_)?URL$/i, "");
    url = v;
    authToken = process.env[prefix + "AUTH_TOKEN"] || process.env[prefix + "DATABASE_AUTH_TOKEN"] || process.env[prefix + "TOKEN"]
      || Object.entries(process.env).find(([kk, vv]) => kk.startsWith(prefix) && /TOKEN/i.test(kk) && !!vv)?.[1];
    console.log(`[migrate] using database URL from ${k}${authToken ? "" : " (no token found)"}`);
    break;
  }
}
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

// Common paste mistakes, caught before we even connect.
const problems = [];
if (url) {
  if (/^https?:\/\//i.test(url)) problems.push(`DATABASE_URL starts with http(s):// — Turso URLs should start with libsql:// (got "${url.slice(0, 12)}…")`);
  if (/\s/.test(url)) problems.push("DATABASE_URL contains whitespace — re-paste it without spaces/newlines");
  if (!authToken && !url.startsWith("file:")) problems.push("DATABASE_AUTH_TOKEN is missing (remote libsql databases need a token)");
  else if (authToken && /\s/.test(authToken)) problems.push("DATABASE_AUTH_TOKEN contains whitespace — re-paste it");
  else if (authToken && !/^eyJ/.test(authToken)) problems.push("DATABASE_AUTH_TOKEN doesn't look like a Turso token (they start with eyJ)");
}
if (url && !/^(libsql|https?|wss?|file):\/\//i.test(url)) problems.push(`DATABASE_URL has no scheme — it must start with libsql:// (e.g. libsql://proofcheck-yourname.aws-ap-south-1.turso.io). Got "${url.slice(0, 20)}…"`);
if (url && /^eyJ/.test(url)) problems.push("DATABASE_URL looks like a token (starts with eyJ) — the URL and the token are swapped");
for (const p of problems) console.warn("[migrate] WARNING:", p);

try {
  const client = createClient({ url: target, authToken });
  const t0 = Date.now();
  const rep = await applySchema(client);
  const host = target.startsWith("file:") ? target : new URL(target).host;
  console.log(`[migrate] ok → ${host} · schema v${rep.version} · ${rep.created} statements · columns added: ${rep.columnsAdded.length ? rep.columnsAdded.join(", ") : "none"} · ${Date.now() - t0}ms`);
} catch (e) {
  console.error("[migrate] FAILED:", String(e.message ?? e).replace(/eyJ[A-Za-z0-9_.-]{20,}/g, "[token redacted]"));
  if (onVercel && !strict) {
    // Don't take the whole deploy down for a DB hiccup: the app applies the schema itself on first request,
    // and /api/health shows the real error. Use --strict to make this fatal.
    console.error("[migrate] Continuing the build anyway. Check /api/health after deploy — it will show the database error.");
    process.exit(0);
  }
  process.exit(1);
}
