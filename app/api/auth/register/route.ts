import { NextResponse } from "next/server";
import { one, run } from "@/lib/db";
import { hashPassword, makeSession, SESSION_COOKIE, sessionCookieOptions, validEmail, authConfigured } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const base = new URL(req.url);
  const back = (msg: string) => NextResponse.redirect(new URL(`/register?e=${encodeURIComponent(msg)}`, base), 303);
  if (!authConfigured()) return back("Server is missing AUTH_SECRET.");
  const fd = await req.formData();
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  const password = String(fd.get("password") ?? "");
  const name = String(fd.get("name") ?? "").trim().slice(0, 80) || null;
  if (!validEmail(email)) return back("Enter a valid email address.");
  if (password.length < 8) return back("Password must be at least 8 characters.");
  if (await one("SELECT 1 FROM users WHERE email = ?", [email])) return back("An account with that email already exists. Sign in instead.");
  const r = await run("INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)", [email, hashPassword(password), name]);
  const id = Number(r.lastInsertRowid);
  const res = NextResponse.redirect(new URL("/app?welcome=1", base), 303);
  res.cookies.set(SESSION_COOKIE, makeSession(id), sessionCookieOptions(base.protocol === "https:"));
  return res;
}
