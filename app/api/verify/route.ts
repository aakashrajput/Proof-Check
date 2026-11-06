import { NextResponse } from "next/server";
import { one, run, type Campaign } from "@/lib/db";
import { verifySubmission } from "@/lib/verify";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Very small in-memory rate limit per IP (per server instance).
const hits = new Map<string, number[]>();
const RATE_MAX = Number(process.env.VERIFY_RATE_PER_MIN ?? 20);
function limited(ip: string, max = RATE_MAX, windowMs = 60_000) {
  const now = Date.now();
  const arr = (hits.get(ip) ?? []).filter((t) => now - t < windowMs);
  arr.push(now); hits.set(ip, arr);
  return arr.length > max;
}

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
  if (RATE_MAX > 0 && limited(ip)) return NextResponse.json({ error: "Too many attempts. Wait a minute." }, { status: 429 });

  const fd = await req.formData();
  const slug = String(fd.get("slug") ?? "");
  const c = await one<Campaign>("SELECT * FROM campaigns WHERE slug = ?", [slug]);
  if (!c) return NextResponse.json({ error: "Unknown task" }, { status: 404 });
  if (c.status !== "active") return NextResponse.json({ error: "This task is closed" }, { status: 410 });

  const files: { bytes: Buffer; mime: string }[] = [];
  for (const f of fd.getAll("file")) {
    if (f instanceof File && f.size > 0) files.push({ bytes: Buffer.from(await f.arrayBuffer()), mime: f.type || "application/octet-stream" });
  }
  await run("INSERT INTO events (campaign_id, kind, src) VALUES (?, 'submitted', ?)", [c.id, (fd.get("src") as string) || null]);

  try {
    const result = await verifySubmission(c, files,
      { worker_ref: (fd.get("worker_ref") as string) || null, src: (fd.get("src") as string) || null, mock: req.headers.get("x-mock-read") },
      (fd.get("text") as string) || null);
    return NextResponse.json(result);
  } catch (e) {
    console.error("verify error", e);
    return NextResponse.json({ error: "Verification failed unexpectedly. Try again." }, { status: 500 });
  }
}
