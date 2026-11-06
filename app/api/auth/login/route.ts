import { NextResponse } from "next/server";
import { one, type User } from "@/lib/db";
import { verifyPassword, makeSession, SESSION_COOKIE, sessionCookieOptions, authConfigured } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Small per-IP throttle against password guessing (per instance).
const attempts = new Map<string, number[]>();

export async function POST(req: Request) {
  const base = new URL(req.url);
  const fd = await req.formData();
  const next = String(fd.get("next") ?? "/app");
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/app";
  const back = (msg: string) => NextResponse.redirect(new URL(`/login?e=${encodeURIComponent(msg)}&next=${encodeURIComponent(safeNext)}`, base), 303);
  if (!authConfigured()) return back("Server is missing AUTH_SECRET.");
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
  const now = Date.now(); const arr = (attempts.get(ip) ?? []).filter((t) => now - t < 10 * 60_000); attempts.set(ip, arr);
  if (arr.length >= 20) return back("Too many attempts. Try again in a few minutes.");
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  const password = String(fd.get("password") ?? "");
  const u = await one<User>("SELECT * FROM users WHERE email = ?", [email]);
  if (!u || !verifyPassword(password, u.password_hash)) { arr.push(now); return back("Wrong email or password."); }
  const res = NextResponse.redirect(new URL(safeNext, base), 303);
  res.cookies.set(SESSION_COOKIE, makeSession(u.id), sessionCookieOptions(base.protocol === "https:"));
  return res;
}
