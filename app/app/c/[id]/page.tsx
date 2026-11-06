import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import { one, q, type Campaign, type Submission, type Variant } from "@/lib/db";
import CampaignForm from "../../CampaignForm";
import { currentUser } from "@/lib/auth";
import { sgCredsFor } from "@/lib/sproutgigs";
import { updateCampaign, setStatus, override, syncNow } from "../../actions";
import Header from "../../Header";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function CampaignPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string; saved?: string }> }) {
  const u = await currentUser();
  if (!u) redirect("/login");
  const { id } = await params;
  const { created, saved } = await searchParams;
  const c = await one<Campaign>("SELECT * FROM campaigns WHERE id = ? AND owner_id = ?", [Number(id), u.id]);
  if (!c) notFound();
  const sgReady = !!sgCredsFor(u);
  const variants = await q<Variant>("SELECT * FROM campaign_variants WHERE campaign_id = ? ORDER BY position", [c.id]);
  const seen = await q<{ variant_id: number | null; n: number }>("SELECT variant_id, COUNT(*) n FROM submissions WHERE campaign_id = ? AND variant_id IS NOT NULL GROUP BY variant_id", [c.id]);
  const seenTotal = seen.reduce((a, r) => a + Number(r.n), 0);
  const gemReady = !!process.env.GEMINI_API_KEY;
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
      {saved && <div className="card" style={{ borderColor: "var(--ok)" }}>Saved.</div>}
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

      {variants.length > 0 && (
        <div className="card">
          <h3>Title &amp; thumbnail variants — what workers reported seeing</h3>
          {seenTotal === 0 ? <p className="small muted">No reports yet. Workers pick the variant they saw when they submit proof.</p> : (
            <>
              <div className="vbar">{variants.map((v) => { const n = Number(seen.find((r) => r.variant_id === v.id)?.n ?? 0); return <span key={v.id} className={v.label.toLowerCase()} style={{ width: `${(100 * n) / seenTotal}%` }} title={`${v.label}: ${n}`} />; })}</div>
              <div className="vlegend">{variants.map((v) => { const n = Number(seen.find((r) => r.variant_id === v.id)?.n ?? 0); return <span key={v.id}><i className={v.label.toLowerCase()} style={{ background: v.label === "A" ? "var(--accent)" : v.label === "B" ? "var(--ok)" : "var(--warn)" }} />{v.label} · {Math.round((100 * n) / seenTotal)}% ({n})</span>; })}</div>
            </>
          )}
          <div className="vcards" style={{ marginTop: 10 }}>
            {variants.map((v) => <div className="vcard" key={v.id} style={{ cursor: "default" }}><img src={v.thumb_data ?? v.thumb_url ?? `https://i.ytimg.com/vi/${c.video_id}/mqdefault.jpg`} alt="" /><div className="vt"><b>{v.label}</b> · {v.title}</div></div>)}
          </div>
          <p className="small muted" style={{ marginTop: 8 }}>This is self-reported by workers, so read it as a recognition signal, not an impression count. Edit variants below.</p>
        </div>
      )}

      <div className="card">
        <h3>Submissions (latest 300)</h3>
        {subs.length === 0 && <p className="muted">Nothing yet.</p>}
        {subs.length > 0 && (
          <table><thead><tr><th>#</th><th>When (UTC)</th><th>Worker</th><th>Result</th><th>Reason</th><th>Via</th><th>Saw</th><th>Video</th><th>Frames</th><th>~sec</th><th>sCPN</th><th>Code</th><th></th></tr></thead>
            <tbody>{subs.map((s) => (
              <tr key={s.id}>
                <td>{s.id}</td><td className="small">{s.created_at}</td><td className="small">{s.worker_ref ?? "—"}{s.src ? <span className="muted"> · {s.src}</span> : null}</td>
                <td><span className={`pill ${s.status}`}>{s.status}</span></td>
                <td className="small">{s.reason}</td>
                <td className="small muted">{s.source ?? "—"}</td>
                <td className="small">{variants.find((v) => v.id === s.variant_id)?.label ?? "—"}</td>
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

      <CampaignForm action={updateCampaign} mode="edit" gemReady={gemReady} initial={{ id: c.id, name: c.name, video_id: c.video_id, video_title: c.video_title, channel_title: c.channel_title, channel_handle: c.channel_handle,
        min_seconds: c.min_seconds, min_frames: c.min_frames, keywords: c.keywords, instructions: c.instructions, proof_mode: c.proof_mode, sg_job_id: c.sg_job_id, duration_seconds: c.duration_seconds, thumbnail_url: c.thumbnail_url,
        variants: variants.map((v) => ({ id: v.id, label: v.label as "A" | "B" | "C", title: v.title, thumb_url: v.thumb_url, thumb_data: v.thumb_data })) }} />
    </div>
  );
}
