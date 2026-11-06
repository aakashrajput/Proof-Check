import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { parseVideoId, resolveVideo } from "@/lib/youtube";

export const dynamic = "force-dynamic";

// Live preview while the employer types a URL. Signed-in users only (it proxies to YouTube).
export async function GET(req: Request) {
  if (!(await currentUser())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const v = new URL(req.url).searchParams.get("v") ?? "";
  const id = parseVideoId(v);
  if (!id) return NextResponse.json({ error: "Not a YouTube URL or video ID" }, { status: 400 });
  const meta = await resolveVideo(id);
  return NextResponse.json(meta, { headers: { "cache-control": "private, max-age=300" } });
}
