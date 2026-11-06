import { NextResponse } from "next/server";
import { syncAll } from "@/lib/sproutgigs";
import { currentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Called by Vercel cron / scripts/poll.mjs (Authorization: Bearer CRON_SECRET → all users),
// or by a signed-in user (→ only their campaigns).
async function authorized(req: Request): Promise<{ all: boolean; ownerId?: number } | null> {
  const auth = req.headers.get("authorization");
  if (process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`) return { all: true };
  const u = await currentUser();
  return u ? { all: false, ownerId: u.id } : null;
}

export async function GET(req: Request) { return handle(req); }
export async function POST(req: Request) { return handle(req); }

async function handle(req: Request) {
  const who = await authorized(req);
  if (!who) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const reports = await syncAll(who.all ? undefined : who.ownerId);
    return NextResponse.json({ ok: true, at: new Date().toISOString(), reports });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
