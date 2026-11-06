import { NextResponse } from "next/server";
import { COOKIE, checkPassword, token } from "@/lib/auth";

export async function POST(req: Request) {
  const fd = await req.formData();
  const pw = String(fd.get("password") ?? "");
  const next = String(fd.get("next") ?? "/admin");
  const base = new URL(req.url);
  if (!checkPassword(pw)) return NextResponse.redirect(new URL(`/admin/login?e=1&next=${encodeURIComponent(next)}`, base), 303);
  const res = NextResponse.redirect(new URL(next.startsWith("/") ? next : "/admin", base), 303);
  res.cookies.set(COOKIE, token(), { httpOnly: true, sameSite: "lax", secure: base.protocol === "https:", path: "/", maxAge: 60 * 60 * 24 * 30 });
  return res;
}
