import { NextResponse, type NextRequest } from "next/server";
import { parseSession, SESSION_COOKIE } from "@/lib/auth";

// Guards the signed-in workspace. Worker pages (/t/*) and the landing page are public.
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const uid = parseSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (pathname.startsWith("/app") && !uid) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  if ((pathname === "/login" || pathname === "/register") && uid) {
    const url = req.nextUrl.clone(); url.pathname = "/app"; url.search = "";
    return NextResponse.redirect(url);
  }
  if (pathname.startsWith("/admin")) {
    const url = req.nextUrl.clone(); url.pathname = pathname.replace(/^\/admin/, "/app") || "/app";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/app/:path*", "/app", "/admin/:path*", "/admin", "/login", "/register"] };
