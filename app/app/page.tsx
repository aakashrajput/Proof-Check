import Link from "next/link";
import { redirect } from "next/navigation";
import { q, dbIsEphemeral, type Campaign } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { sgCredsFor } from "@/lib/sproutgigs";
import { createCampaign } from "./actions";
import Header from "./Header";

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

      <form className="card" action={createCampaign}>
        <h2>New campaign</h2>
        <div className="row">
          <div><label htmlFor="name">Name</label><input id="name" name="name" required placeholder="Nov promo — video 3" /></div>
          <div><label htmlFor="video">YouTube video URL or ID</label><input id="video" name="video" required placeholder="https://youtu.be/…" /></div>
        </div>
        <div className="row">
          <div><label htmlFor="min_seconds">Minimum watch time (seconds)</label><input id="min_seconds" name="min_seconds" type="number" min={0} defaultValue={120} /></div>
          <div><label htmlFor="min_frames">Minimum frames (optional, used when fps isn't readable)</label><input id="min_frames" name="min_frames" type="number" min={0} defaultValue={0} /></div>
        </div>
        <label htmlFor="keywords">Search keywords — one per line, rotated evenly across workers</label>
        <textarea id="keywords" name="keywords" rows={4} placeholder={"best budget phone 2026 review\nbudget phone camera test"} />
        <label htmlFor="instructions">Custom instructions (optional — a default step list is shown if blank)</label>
        <textarea id="instructions" name="instructions" rows={3} />
        <div className="row">
          <div><label htmlFor="proof_mode">Accepted proof</label>
            <select id="proof_mode" name="proof_mode" defaultValue={gemReady ? "either" : "text"}>
              <option value="either">Debug-info text OR screenshot</option>
              <option value="text">Debug-info text only (no AI cost)</option>
              <option value="screenshot" disabled={!gemReady}>Screenshot only{gemReady ? "" : " (needs GEMINI_API_KEY)"}</option>
              <option value="both" disabled={!gemReady}>Both required{gemReady ? "" : " (needs GEMINI_API_KEY)"}</option>
            </select></div>
          <div><label htmlFor="sg_job_id">SproutGigs job ID (optional — enables auto-rating)</label><input id="sg_job_id" name="sg_job_id" placeholder="e.g. 123456" /></div>
        </div>
        <div style={{ marginTop: 12 }}><button type="submit">Create campaign</button></div>
      </form>
    </div>
  );
}
