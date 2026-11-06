import { NextResponse } from "next/server";
import { one, run, type Campaign } from "@/lib/db";

export const dynamic = "force-dynamic";

// Worker-side reports that aren't proof submissions, e.g. "I couldn't find the video on YouTube".
const hits = new Map<string, number[]>();
export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
  const now = Date.now(); const arr = (hits.get(ip) ?? []).filter((t) => now - t < 60_000); arr.push(now); hits.set(ip, arr);
  if (arr.length > 10) return NextResponse.json({ error: "Too many reports. Wait a minute." }, { status: 429 });

  let body: { slug?: string; kind?: string; worker_ref?: string; src?: string; keyword?: string; note?: string } = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }
  const c = await one<Campaign>("SELECT id FROM campaigns WHERE slug = ?", [String(body.slug ?? "")]);
  if (!c) return NextResponse.json({ error: "Unknown task" }, { status: 404 });
  const kind = body.kind === "not_found" ? "not_found" : null;
  if (!kind) return NextResponse.json({ error: "Unknown report kind" }, { status: 400 });
  const worker = String(body.worker_ref ?? "").trim().slice(0, 80) || null;
  const note = String(body.note ?? "").trim().slice(0, 500) || null;
  const keyword = String(body.keyword ?? "").trim().slice(0, 200) || null;
  // one report per worker per campaign per kind (update note instead of stacking)
  const prior = worker ? await one<{ id: number }>("SELECT id FROM reports WHERE campaign_id = ? AND kind = ? AND worker_ref = ? LIMIT 1", [c.id, kind, worker]) : null;
  if (prior) await run("UPDATE reports SET note = COALESCE(?, note), keyword = COALESCE(?, keyword), created_at = datetime('now') WHERE id = ?", [note, keyword, prior.id]);
  else await run("INSERT INTO reports (campaign_id, kind, worker_ref, src, keyword, note) VALUES (?, ?, ?, ?, ?, ?)", [c.id, kind, worker, String(body.src ?? "") || null, keyword, note]);
  await run("INSERT INTO events (campaign_id, kind, src) VALUES (?, 'not_found', ?)", [c.id, String(body.src ?? "") || null]);
  return NextResponse.json({ ok: true });
}
