import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { syncAll } from "@/lib/sproutgigs";
import { COOKIE, validToken } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Called by Vercel cron (Authorization: Bearer CRON_SECRET), scripts/poll.mjs, or the admin "Sync now" button.
async function authorized(req: Request) {
  const auth = req.headers.get("authorization");
  if (process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`) return true;
  const c = await cookies();
  return validToken(c.get(COOKIE)?.value);
}

export async function GET(req: Request) { return handle(req); }
export async function POST(req: Request) { return handle(req); }

async function handle(req: Request) {
  if (!(await authorized(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const reports = await syncAll();
    return NextResponse.json({ ok: true, at: new Date().toISOString(), reports });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
