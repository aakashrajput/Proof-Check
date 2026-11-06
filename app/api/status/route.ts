import { NextResponse } from "next/server";
import { one, q, mmss, humanDur, type Campaign, type Submission } from "@/lib/db";

export const dynamic = "force-dynamic";

// Worker self-service: "what happened to my submission?" — latest result for a worker on a task, incl. codes issued by manual approval.
export async function GET(req: Request) {
  const u = new URL(req.url);
  const slug = u.searchParams.get("slug") ?? "", w = (u.searchParams.get("w") ?? "").trim();
  if (!slug || w.length < 2) return NextResponse.json({ error: "slug and w required" }, { status: 400 });
  const c = await one<Campaign>("SELECT * FROM campaigns WHERE slug = ?", [slug]);
  if (!c) return NextResponse.json({ error: "Unknown task" }, { status: 404 });
  const rows = await q<Submission>("SELECT * FROM submissions WHERE campaign_id = ? AND worker_ref = ? COLLATE NOCASE ORDER BY (status = 'pass') DESC, id DESC LIMIT 5", [c.id, w]);
  if (!rows.length) return NextResponse.json({ found: false, message: "No submissions found for that username on this task. Check the spelling (it must match what you entered when you verified)." });
  const best = rows[0];
  const minS = c.min_seconds || 0;
  let message: string, next: string | null = null;
  if (best.status === "pass") { message = best.reason === "manual_override" ? "Approved by the employer." : "Verified."; next = "Paste the code below as your proof on the job site. It works once."; }
  else if (best.status === "review") { message = "Waiting for the employer to review it by hand."; next = "You can also paste fresh debug info to get an instant decision."; }
  else {
    message = `Not verified yet (${best.reason.replace(/_/g, " ")}).`;
    if (best.reason === "insufficient_watch_time" && best.watch_seconds != null && minS) {
      // Same cumulative rule as verification: distinct, unpaid, uncredited sessions add up.
      const others = (c.cumulative_watch ?? 1) !== 0 ? await q<{ w: number }>("SELECT COALESCE(SUM(watch_seconds),0) w FROM submissions WHERE campaign_id = ? AND worker_ref = ? COLLATE NOCASE AND status='fail' AND reason='insufficient_watch_time' AND watch_seconds IS NOT NULL AND scpn IS NOT NULL AND credited_to IS NULL AND id != ? AND created_at > datetime('now','-3 days')", [c.id, w, best.id]) : [{ w: 0 }];
      const total = Number(best.watch_seconds) + Number(others[0]?.w ?? 0);
      const more = Math.ceil(minS - total);
      next = total >= minS
        ? `You already have ${mmss(total)} across your sessions — paste fresh debug info from the video once more to collect your code.`
        : `You have ${mmss(total)} of ${mmss(minS)}${total > Number(best.watch_seconds) ? " across your sessions" : ""}. Keep the video playing ${humanDur(Math.max(1, more))} more, then copy fresh debug info and verify again — your earlier time counts.`;
    }
    else if (best.reason === "second_paste_needed") next = "Keep the same video playing and paste the debug info again after the minimum time.";
    else next = "Verify again with fresh proof — retrying is free.";
  }
  return NextResponse.json({
    found: true, status: best.status, reason: best.reason, message, next, payout_code: best.payout_code,
    watched_seconds: best.watch_seconds, needed_seconds: minS, attempts: best.attempts, updated_at: best.updated_at ?? best.created_at,
    history: rows.slice(0, 5).map((r) => ({ id: r.id, status: r.status, reason: r.reason, watched: r.watch_seconds, at: r.updated_at ?? r.created_at })),
  });
}
