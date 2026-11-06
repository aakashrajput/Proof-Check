import Link from "next/link";
import { q, dbIsEphemeral, type Campaign } from "@/lib/db";
import { createCampaign } from "./actions";

export const dynamic = "force-dynamic";

type Row = Campaign & { total: number; passed: number; failed: number; review: number; opened: number };

export default async function Admin() {
  let rows: Row[] = [];
  let dbError: string | null = null;
  try {
    rows = await q<Row>(`
    SELECT c.*,
      (SELECT COUNT(*) FROM submissions s WHERE s.campaign_id=c.id) total,
      (SELECT COUNT(*) FROM submissions s WHERE s.campaign_id=c.id AND status='pass') passed,
      (SELECT COUNT(*) FROM submissions s WHERE s.campaign_id=c.id AND status='fail') failed,
      (SELECT COUNT(*) FROM submissions s WHERE s.campaign_id=c.id AND status='review') review,
      (SELECT COUNT(*) FROM events e WHERE e.campaign_id=c.id AND kind='opened') opened
    FROM campaigns c ORDER BY c.id DESC`);
  } catch (e) { dbError = String(e); }
  const sgReady = !!(process.env.SG_USER_ID && process.env.SG_API_SECRET);
  const gemReady = !!process.env.GEMINI_API_KEY || !!process.env.GEMINI_MOCK_JSON;

  return (
    <div className="wrap">
      <div className="top"><div className="brand">Proof<span>Check</span> · admin</div>
        <span className="small muted">Gemini {gemReady ? "✓" : "✗ (set GEMINI_API_KEY)"} · SproutGigs {sgReady ? "✓" : "✗ (set SG_USER_ID / SG_API_SECRET)"}</span></div>

      {dbError && <div className="card" style={{ borderColor: "var(--bad)" }}><h2 style={{ color: "var(--bad)" }}>Database error</h2><div className="term">{dbError}</div>
        <p className="small muted">Check <a href="/api/health">/api/health</a>. On Vercel, attach Turso under Storage (or set DATABASE_URL) and redeploy.</p></div>}
      {!dbError && dbIsEphemeral() && <div className="card" style={{ borderColor: "var(--warn)" }}><b style={{ color: "var(--warn)" }}>No persistent database.</b> <span className="small">Running on temporary storage — campaigns and codes vanish on each cold start. Attach Turso under Vercel → Storage, then redeploy. <a href="/api/health">Details</a></span></div>}
      <div className="card">
        <h2>Campaigns</h2>
        {rows.length === 0 && <p className="muted">No campaigns yet. Create one below.</p>}
        {rows.length > 0 && (
          <table><thead><tr><th>Name</th><th>Video</th><th>Status</th><th>Opened</th><th>Submitted</th><th>Pass</th><th>Fail</th><th>Review</th><th>SG job</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id}>
                <td><Link href={`/admin/c/${r.id}`}><b>{r.name}</b></Link><br /><span className="small muted">/t/{r.slug}</span></td>
                <td className="small">{r.video_title ?? r.video_id}</td>
                <td><span className={`pill ${r.status === "active" ? "pass" : r.status === "paused" ? "review" : "fail"}`}>{r.status}</span></td>
                <td>{r.opened}</td><td>{r.total}</td><td style={{ color: "var(--ok)" }}>{r.passed}</td><td style={{ color: "var(--bad)" }}>{r.failed}</td><td style={{ color: "var(--warn)" }}>{r.review}</td>
                <td className="small">{r.sg_job_id ?? "—"}</td>
              </tr>))}</tbody></table>
        )}
      </div>

      <form className="card" action={createCampaign}>
        <h2>New campaign</h2>
        <div className="row">
          <div><label>Name</label><input name="name" required placeholder="Nov promo — video 3" /></div>
          <div><label>YouTube video URL or ID</label><input name="video" required placeholder="https://youtu.be/…" /></div>
        </div>
        <div className="row">
          <div><label>Minimum watch time (seconds)</label><input name="min_seconds" type="number" min={0} defaultValue={120} /></div>
          <div><label>Minimum frames (optional; overrides if fps unreadable)</label><input name="min_frames" type="number" min={0} defaultValue={0} /></div>
        </div>
        <label>Search keywords — one per line, rotated evenly across workers</label>
        <textarea name="keywords" rows={4} placeholder={"best budget phone 2026 review\nbudget phone camera test"} />
        <label>Custom instructions (optional — default step list is shown if blank)</label>
        <textarea name="instructions" rows={3} />
        <div className="row">
          <div><label>Accepted proof</label>
            <select name="proof_mode" defaultValue="either">
              <option value="either">Debug-info text OR screenshot (recommended)</option>
              <option value="text">Debug-info text only (no AI cost)</option>
              <option value="screenshot">Screenshot only</option>
              <option value="both">Both required (strictest)</option>
            </select></div>
          <div><label>SproutGigs job ID (optional — enables auto-rating)</label><input name="sg_job_id" placeholder="e.g. 123456" /></div>
        </div>
        <div style={{ marginTop: 12 }}><button type="submit">Create campaign</button></div>
      </form>
    </div>
  );
}
