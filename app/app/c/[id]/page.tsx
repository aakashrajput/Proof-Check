import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import { one, q, type Campaign, type Submission } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { sgCredsFor } from "@/lib/sproutgigs";
import { updateCampaign, setStatus, override, syncNow } from "../../actions";
import Header from "../../Header";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function CampaignPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  const u = await currentUser();
  if (!u) redirect("/login");
  const { id } = await params;
  const { created } = await searchParams;
  const c = await one<Campaign>("SELECT * FROM campaigns WHERE id = ? AND owner_id = ?", [Number(id), u.id]);
  if (!c) notFound();
  const sgReady = !!sgCredsFor(u);
  const subs = await q<Submission>("SELECT * FROM submissions WHERE campaign_id = ? ORDER BY id DESC LIMIT 300", [c.id]);
  const counts = await one<{ opened: number; submitted: number; verified: number; rejected: number }>(`
    SELECT SUM(kind='opened') opened, SUM(kind='submitted') submitted, SUM(kind='verified') verified, SUM(kind='rejected') rejected FROM events WHERE campaign_id = ?`, [c.id]);
  const reasons = await q<{ reason: string; n: number }>("SELECT reason, COUNT(*) n FROM submissions WHERE campaign_id=? AND status!='pass' GROUP BY reason ORDER BY n DESC LIMIT 6", [c.id]);
  const ratings = await q<{ rating: string; n: number }>("SELECT rating, COUNT(*) n FROM sg_ratings WHERE campaign_id=? GROUP BY rating", [c.id]);
  const lastSync = await one<{ src: string; created_at: string }>("SELECT src, created_at FROM events WHERE campaign_id=? AND kind='sync' ORDER BY id DESC LIMIT 1", [c.id]);

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const link = `${proto}://${host}/t/${c.slug}`;
  const passRate = counts?.submitted ? Math.round(100 * (counts.verified ?? 0) / counts.submitted) : 0;

  return (
    <div className="wrap">
      <Header email={u.email} crumb={c.name} />
      <div className="top"><span className={`pill ${c.status === "active" ? "pass" : c.status === "paused" ? "review" : "fail"}`}>{c.status}</span></div>
      {created && <div className="card" style={{ borderColor: "var(--ok)" }}><b>Campaign created.</b> Paste the task link below into your job description. Workers who open it see your keyword, the requirements, and exactly why a proof fails before they submit anything on the job site.</div>}

      <div className="card">
        <h3>Task link for workers (paste into the job description)</h3>
        <div className="kw"><span>{link}?src=sg</span><a className="btn secondary" href={`${link}?src=preview`} target="_blank" rel="noreferrer" style={{ whiteSpace: "nowrap" }}>Preview ↗</a></div>
        <p className="small muted">Append <code>?src=wuj</code> for WorkUpJob, <code>&w=USERNAME</code> to prefill a worker id.</p>
        <div className="actions" style={{ marginTop: 10 }}>
          {c.status !== "active" && <form action={setStatus}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="status" value="active" /><button>Resume</button></form>}
          {c.status === "active" && <form action={setStatus}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="status" value="paused" /><button className="secondary">Pause</button></form>}
          {c.status !== "closed" && <form action={setStatus}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="status" value="closed" /><button className="danger">Close</button></form>}
          {c.sg_job_id && <form action={syncNow}><input type="hidden" name="id" value={c.id} /><button className="secondary" title={sgReady ? "" : "Add SproutGigs credentials in Settings"}>Sync SproutGigs now</button></form>}
          {c.sg_job_id && !sgReady && <span className="small muted" style={{ alignSelf: "center" }}>Add SproutGigs credentials in <Link href="/app/settings">Settings</Link> to enable syncing.</span>}
        </div>
      </div>

      <div className="card">
        <h3>Funnel</h3>
        <div className="stats">
          <div className="stat"><b>{counts?.opened ?? 0}</b><span className="small muted">opened</span></div>
          <div className="stat"><b>{counts?.submitted ?? 0}</b><span className="small muted">submitted</span></div>
          <div className="stat"><b style={{ color: "var(--ok)" }}>{counts?.verified ?? 0}</b><span className="small muted">verified</span></div>
          <div className="stat"><b style={{ color: "var(--bad)" }}>{counts?.rejected ?? 0}</b><span className="small muted">rejected</span></div>
          <div className="stat"><b>{passRate}%</b><span className="small muted">pass rate</span></div>
        </div>
        {reasons.length > 0 && <p className="small muted" style={{ marginTop: 10 }}>Top fail reasons: {reasons.map((r) => `${r.reason} (${r.n})`).join(" · ")}</p>}
        {c.sg_job_id && <p className="small muted">SproutGigs ratings sent: {ratings.length ? ratings.map((r) => `${r.rating} ${r.n}`).join(" · ") : "none yet"}{lastSync ? ` · last sync ${lastSync.created_at} UTC` : ""}</p>}
        {lastSync && <div className="term" style={{ marginTop: 8 }}>{lastSync.src}</div>}
      </div>

      <div className="card">
        <h3>Submissions (latest 300)</h3>
        {subs.length === 0 && <p className="muted">Nothing yet.</p>}
        {subs.length > 0 && (
          <table><thead><tr><th>#</th><th>When (UTC)</th><th>Worker</th><th>Result</th><th>Reason</th><th>Via</th><th>Video</th><th>Frames</th><th>~sec</th><th>sCPN</th><th>Code</th><th></th></tr></thead>
            <tbody>{subs.map((s) => (
              <tr key={s.id}>
                <td>{s.id}</td><td className="small">{s.created_at}</td><td className="small">{s.worker_ref ?? "—"}{s.src ? <span className="muted"> · {s.src}</span> : null}</td>
                <td><span className={`pill ${s.status}`}>{s.status}</span></td>
                <td className="small">{s.reason}</td>
                <td className="small muted">{s.source ?? "—"}</td>
                <td className="small" style={{ color: s.video_id_read && s.video_id_read !== c.video_id ? "var(--bad)" : undefined }}>{s.video_id_read ?? "—"}</td>
                <td>{s.frames_total ?? "—"}</td><td title={s.played_seconds != null ? `played ranges: ${s.played_seconds}s` : undefined}>{s.watch_seconds != null ? Math.round(s.watch_seconds) : "—"}</td>
                <td className="small" style={{ fontFamily: "var(--mono)" }}>{s.scpn ? s.scpn.slice(0, 8) + "…" : "—"}</td>
                <td style={{ fontFamily: "var(--mono)" }}>{s.payout_code ?? "—"}</td>
                <td className="actions">
                  {s.status !== "pass" && <form action={override}><input type="hidden" name="submission_id" value={s.id} /><input type="hidden" name="campaign_id" value={c.id} /><input type="hidden" name="to" value="pass" /><button className="secondary small">Approve</button></form>}
                  {s.status !== "fail" && <form action={override}><input type="hidden" name="submission_id" value={s.id} /><input type="hidden" name="campaign_id" value={c.id} /><input type="hidden" name="to" value="fail" /><button className="secondary small">Reject</button></form>}
                </td>
              </tr>))}</tbody></table>
        )}
      </div>

      <form className="card" action={updateCampaign}>
        <h3>Edit campaign</h3>
        <input type="hidden" name="id" value={c.id} />
        <div className="row">
          <div><label>Name</label><input name="name" defaultValue={c.name} /></div>
          <div><label>Video URL/ID (current: {c.video_id}{c.video_title ? ` — ${c.video_title}` : ""})</label><input name="video" defaultValue={c.video_id} /></div>
        </div>
        <div className="row">
          <div><label>Min watch seconds</label><input name="min_seconds" type="number" defaultValue={c.min_seconds} /></div>
          <div><label>Min frames</label><input name="min_frames" type="number" defaultValue={c.min_frames} /></div>
        </div>
        <label>Keywords (one per line)</label><textarea name="keywords" rows={4} defaultValue={c.keywords} />
        <label>Instructions</label><textarea name="instructions" rows={3} defaultValue={c.instructions} />
        <div className="row">
          <div><label>Accepted proof</label>
            <select name="proof_mode" defaultValue={c.proof_mode ?? "either"}>
              <option value="either">Debug-info text OR screenshot</option>
              <option value="text">Debug-info text only</option>
              <option value="screenshot">Screenshot only</option>
              <option value="both">Both required</option>
            </select></div>
          <div><label>SproutGigs job ID</label><input name="sg_job_id" defaultValue={c.sg_job_id ?? ""} /></div>
        </div>
        <div style={{ marginTop: 12 }}><button type="submit">Save</button></div>
      </form>
    </div>
  );
}
