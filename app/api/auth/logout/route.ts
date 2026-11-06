import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth";

function out(req: Request) {
  const u = new URL(req.url);
  const next = u.searchParams.get("next") ?? "/";
  const safe = next.startsWith("/") && !next.startsWith("//") ? next : "/";
  const res = NextResponse.redirect(new URL(safe, u), 303);
  res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
export async function POST(req: Request) { return out(req); }
export async function GET(req: Request) { return out(req); }
