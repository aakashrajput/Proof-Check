import Link from "next/link";
import { redirect } from "next/navigation";
import { q, dbIsEphemeral, type Campaign } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { sgCredsFor } from "@/lib/sproutgigs";
import { createCampaign } from "./actions";
import Header from "./Header";
import CampaignForm from "./CampaignForm";

export const dynamic = "force-dynamic";

type Row = Campaign & { total: number; passed: number; failed: number; review: number; opened: number };

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ e?: string; welcome?: string }> }) {
  const u = await currentUser();
  if (!u) redirect("/login");
  const { e, welcome } = await searchParams;
  let rows: Row[] = []; let dbError: string | null = null;
  try {
    rows = await q<Row>(`
      SELECT c.*,
        (SELECT COUNT(*) FROM submissions s WHERE s.campaign_id=c.id) total,
        (SELECT COUNT(*) FROM submissions s WHERE s.campaign_id=c.id AND status='pass') passed,
        (SELECT COUNT(*) FROM submissions s WHERE s.campaign_id=c.id AND status='fail') failed,
        (SELECT COUNT(*) FROM submissions s WHERE s.campaign_id=c.id AND status='review') review,
        (SELECT COUNT(*) FROM events e WHERE e.campaign_id=c.id AND kind='opened') opened
      FROM campaigns c WHERE c.owner_id = ? ORDER BY c.id DESC`, [u.id]);
  } catch (err) { dbError = String(err); }
  const sgReady = !!sgCredsFor(u);
  const gemReady = !!process.env.GEMINI_API_KEY;

  return (
    <div className="wrap">
      <Header email={u.email} />
      {welcome && <div className="card" style={{ borderColor: "var(--accent)" }}><b>Welcome{u.name ? `, ${u.name}` : ""}.</b> Create your first campaign below. You'll get one task link to paste into your job description; workers open it, submit proof, and get a payout code only when the proof passes.</div>}
      {e && <div className="card" style={{ borderColor: "var(--bad)" }}>{e}</div>}
      {dbError && <div className="card" style={{ borderColor: "var(--bad)" }}><h2 style={{ color: "var(--bad)" }}>Database error</h2><div className="term">{dbError}</div><p className="small muted">See <a href="/api/health">/api/health</a>.</p></div>}
      {!dbError && dbIsEphemeral() && <div className="card" style={{ borderColor: "var(--warn)" }}><b style={{ color: "var(--warn)" }}>No persistent database.</b> <span className="small">Data vanishes on each cold start. Attach Turso under Vercel → Storage. <a href="/api/health">Details</a></span></div>}
      {!sgReady && <div className="card small" style={{ borderColor: "var(--line)" }}>SproutGigs auto-rating is off until you add your API credentials in <Link href="/app/settings">Settings</Link>. Verification and payout codes work without it.</div>}

      <div className="card">
        <h2>Your campaigns</h2>
        {rows.length === 0 && !dbError && <p className="muted">No campaigns yet. Create one below.</p>}
        {rows.length > 0 && (
          <div className="tablewrap"><table><thead><tr><th>Name</th><th>Video</th><th>Status</th><th>Opened</th><th>Submitted</th><th>Pass</th><th>Fail</th><th>Review</th><th>SG job</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id}>
                <td><Link href={`/app/c/${r.id}`}><b>{r.name}</b></Link><br /><span className="small muted">/t/{r.slug}</span></td>
                <td className="small">{r.video_title ?? r.video_id}</td>
                <td><span className={`pill ${r.status === "active" ? "pass" : r.status === "paused" ? "review" : "fail"}`}>{r.status}</span></td>
                <td>{r.opened}</td><td>{r.total}</td><td style={{ color: "var(--ok)" }}>{r.passed}</td><td style={{ color: "var(--bad)" }}>{r.failed}</td><td style={{ color: "var(--warn)" }}>{r.review}</td>
                <td className="small">{r.sg_job_id ?? "—"}</td>
              </tr>))}</tbody></table></div>
        )}
      </div>

      <CampaignForm action={createCampaign} mode="create" gemReady={gemReady} />
    </div>
  );
}
