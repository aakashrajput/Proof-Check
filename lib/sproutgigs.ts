// SproutGigs employer API client. Docs: https://sproutgigs.com/api/documentation.php
// Auth: Authorization: Basic base64(USER_ID:API_SECRET). Rate limit: 1 req/s (429 -> wait 10s).
import { q, one, run, type Campaign, type User } from "./db";
import { decrypt } from "./auth";

const BASE = "https://sproutgigs.com/api";
const CODE_RE = /\bpw-[a-f0-9]{8}\b/gi;

export type SgCreds = { userId: string; secret: string };

/** Per-user credentials (stored encrypted), falling back to SG_USER_ID / SG_API_SECRET env for single-tenant setups. */
export function sgCredsFor(u: Pick<User, "sg_user_id" | "sg_secret_enc"> | null | undefined): SgCreds | null {
  if (u?.sg_user_id && u.sg_secret_enc) {
    try { return { userId: u.sg_user_id, secret: decrypt(u.sg_secret_enc) }; } catch { return null; }
  }
  if (process.env.SG_USER_ID && process.env.SG_API_SECRET) return { userId: process.env.SG_USER_ID, secret: process.env.SG_API_SECRET };
  return null;
}

function authHeader(c: SgCreds) {
  return "Basic " + Buffer.from(`${c.userId}:${c.secret}`).toString("base64");
}

// ---- 1 request/second throttle (process-local) ----
let chain: Promise<unknown> = Promise.resolve();
let last = 0;
function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const p = chain.then(async () => {
    const wait = Math.max(0, 1050 - (Date.now() - last));
    if (wait) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
    return fn();
  });
  chain = p.catch(() => {});
  return p;
}

type SgResp = { ok?: boolean; message?: string; [k: string]: unknown };

async function call(creds: SgCreds, path: string, opts: { method?: "GET" | "POST"; query?: Record<string, string | number | undefined>; body?: unknown } = {}): Promise<SgResp> {
  return throttled(async () => {
    const url = new URL(`${BASE}/${path}`);
    for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
    const doFetch = () => fetch(url, {
      method: opts.method ?? "GET",
      headers: { Authorization: authHeader(creds), "content-type": "application/json" },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    let res = await doFetch();
    if (res.status === 429) { await new Promise((r) => setTimeout(r, 10_000)); res = await doFetch(); }
    const text = await res.text();
    let json: SgResp;
    try { json = JSON.parse(text); } catch { throw new Error(`SproutGigs ${path} -> non-JSON (${res.status}): ${text.slice(0, 200)}`); }
    if (!res.ok || json.ok === false) throw new Error(`SproutGigs ${path}: ${json.message ?? res.status}`);
    return json;
  });
}

// ---- Endpoints (bound to one user's credentials) ----
export function sgFor(creds: SgCreds) {
  return {
    getJob: (job_id: string) => call(creds, "jobs/get-job.php", { query: { job_id } }),
    getJobs: (status?: string, page = 1) => call(creds, "jobs/get-jobs.php", { query: { status, page } }),
    getUnratedTasks: (job_id: string, page = 1) => call(creds, "jobs/get-unrated-tasks.php", { query: { job_id, page } }),
    getRatedTasks: (job_id: string, page = 1) => call(creds, "jobs/get-rated-tasks.php", { query: { job_id, page } }),
    rateTasks: (job_id: string, tasks: { id: string; rating: "ok" | "not_ok" | "revise" }[]) =>
      call(creds, "jobs/rate-multiple-tasks.php", { method: "POST", body: { job_id, tasks } }),
    pause: (job_id: string) => call(creds, "jobs/job-pause.php", { method: "POST", body: { job_id } }),
    resume: (job_id: string) => call(creds, "jobs/job-resume.php", { method: "POST", body: { job_id } }),   // verify path in docs
    stop: (job_id: string) => call(creds, "jobs/job-stop.php", { method: "POST", body: { job_id } }),       // verify path in docs
    balances: () => call(creds, "users/get-balances.php"),
  };
}

// ---- Defensive extraction of tasks from an unrated-tasks response ----
type SgTask = { id: string; raw: unknown; text: string };
function extractTasks(resp: SgResp): { tasks: SgTask[]; next_page: boolean } {
  const candidates = [resp.tasks, resp.data, resp.results, (resp.data as { tasks?: unknown })?.tasks];
  const arr = (candidates.find(Array.isArray) as unknown[] | undefined) ?? [];
  const tasks: SgTask[] = arr.map((t) => {
    const o = t as Record<string, unknown>;
    const id = String(o.id ?? o.task_id ?? "");
    return { id, raw: t, text: JSON.stringify(t) };
  }).filter((t) => t.id);
  return { tasks, next_page: !!(resp.next_page ?? (resp.data as { next_page?: unknown })?.next_page) };
}

export type SyncReport = { campaign: string; job_id: string; seen: number; ok: number; unmatched: number; skipped: number; errors: string[] };

/**
 * Poll one campaign's linked job, match payout codes in proof text, rate.
 * Unmatched policy (SG_UNMATCHED_ACTION): skip (default) | revise | not_ok
 */
export async function syncCampaign(c: Campaign, creds: SgCreds): Promise<SyncReport> {
  const rep: SyncReport = { campaign: c.name, job_id: c.sg_job_id ?? "", seen: 0, ok: 0, unmatched: 0, skipped: 0, errors: [] };
  if (!c.sg_job_id) return rep;
  const sg = sgFor(creds);
  const unmatchedAction = (process.env.SG_UNMATCHED_ACTION ?? "skip") as "skip" | "revise" | "not_ok";

  let page = 1;
  const ratings: { id: string; rating: "ok" | "not_ok" | "revise"; code: string | null; note: string }[] = [];
  for (;;) {
    let resp: SgResp;
    try { resp = await sg.getUnratedTasks(c.sg_job_id, page); } catch (e) { rep.errors.push(String(e)); break; }
    const { tasks, next_page } = extractTasks(resp);
    rep.seen += tasks.length;
    for (const t of tasks) {
      const already = await one("SELECT 1 FROM sg_ratings WHERE sg_task_id = ?", [t.id]);
      if (already) { rep.skipped++; continue; }
      const codes = [...new Set((t.text.match(CODE_RE) ?? []).map((s) => s.toLowerCase()))];
      let matched: string | null = null;
      for (const code of codes) {
        const row = await one<{ code: string; used_at: string | null; campaign_id: number }>("SELECT code, used_at, campaign_id FROM codes WHERE code = ?", [code]);
        if (row && !row.used_at && row.campaign_id === c.id) { matched = row.code; break; }
      }
      if (matched) {
        ratings.push({ id: t.id, rating: "ok", code: matched, note: "code matched" });
      } else {
        rep.unmatched++;
        const note = codes.length ? `code(s) ${codes.join(",")} unknown/used/other campaign` : "no payout code in proof";
        if (unmatchedAction === "skip") { rep.skipped++; continue; }
        ratings.push({ id: t.id, rating: unmatchedAction, code: codes[0] ?? null, note });
      }
    }
    if (!next_page || page >= 20) break;
    page++;
  }

  // Rate in batches, record locally, burn codes.
  for (let i = 0; i < ratings.length; i += 500) {
    const batch = ratings.slice(i, i + 500);
    try {
      await sg.rateTasks(c.sg_job_id, batch.map(({ id, rating }) => ({ id, rating })));
      for (const r of batch) {
        await run("INSERT OR IGNORE INTO sg_ratings (campaign_id, sg_task_id, rating, code, note) VALUES (?, ?, ?, ?, ?)", [c.id, r.id, r.rating, r.code, r.note]);
        if (r.rating === "ok" && r.code) await run("UPDATE codes SET used_at = datetime('now'), sg_task_id = ? WHERE code = ?", [r.id, r.code]);
        if (r.rating === "ok") rep.ok++;
      }
    } catch (e) { rep.errors.push(String(e)); }
  }
  return rep;
}

/** Sync every active linked campaign using its owner's credentials. ownerId limits to one user's campaigns. */
export async function syncAll(ownerId?: number): Promise<SyncReport[]> {
  const cs = await q<Campaign & { sg_user_id: string | null; sg_secret_enc: string | null }>(
    `SELECT c.*, u.sg_user_id, u.sg_secret_enc FROM campaigns c LEFT JOIN users u ON u.id = c.owner_id
     WHERE c.sg_job_id IS NOT NULL AND c.sg_job_id != '' AND c.status = 'active'` + (ownerId ? " AND c.owner_id = ?" : ""),
    ownerId ? [ownerId] : []);
  const out: SyncReport[] = [];
  for (const c of cs) {
    const creds = sgCredsFor(c);
    if (!creds) { out.push({ campaign: c.name, job_id: c.sg_job_id ?? "", seen: 0, ok: 0, unmatched: 0, skipped: 0, errors: ["owner has no SproutGigs credentials"] }); continue; }
    out.push(await syncCampaign(c, creds));
  }
  return out;
}
