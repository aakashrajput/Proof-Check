import { notFound } from "next/navigation";
import { one, run, type Campaign } from "@/lib/db";
import UploadForm from "./UploadForm";
import CopyBtn from "./Copy";

export const dynamic = "force-dynamic";

export default async function TaskPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ src?: string; w?: string }> }) {
  const { slug } = await params;
  const { src, w } = await searchParams;
  const c = await one<Campaign>("SELECT * FROM campaigns WHERE slug = ?", [slug]);
  if (!c) notFound();

  // Keyword rotation: distribute evenly (round-robin).
  const kws = c.keywords.split("\n").map((s) => s.trim()).filter(Boolean);
  let keyword: string | null = null;
  if (kws.length) {
    keyword = kws[c.keyword_cursor % kws.length];
    await run("UPDATE campaigns SET keyword_cursor = keyword_cursor + 1 WHERE id = ?", [c.id]);
  }
  await run("INSERT INTO events (campaign_id, kind, src) VALUES (?, 'opened', ?)", [c.id, src ?? null]);

  const closed = c.status !== "active";
  const minTxt = c.min_seconds ? `${Math.floor(c.min_seconds / 60)}:${String(c.min_seconds % 60).padStart(2, "0")} min` : c.min_frames ? `${c.min_frames} frames` : null;

  return (
    <div className="wrap narrow">
      <div className="top"><div className="brand">Proof<span>Check</span></div><span className="muted small">task {c.slug}</span></div>

      <div className="card">
        <h1>{c.name}</h1>
        {c.video_title && <p className="muted">Video: <b>{c.video_title}</b>{c.channel_title ? <> · Channel: <b>{c.channel_handle ?? c.channel_title}</b></> : null}</p>}
        {closed && <p style={{ color: "var(--bad)" }}>This task is currently closed.</p>}
      </div>

      <div className="card" style={{ borderColor: "var(--accent)" }}>
        <h3>Before you start — what gets a proof declined</h3>
        <ul className="reqs small">
          <li><b>Wrong video.</b> Proof must come from <b>{c.video_title ?? c.video_id}</b>{c.channel_title ? <> by <b>{c.channel_handle ?? c.channel_title}</b></> : null}.</li>
          {minTxt && <li><b>Too short.</b> The video must actually play for at least <b>{minTxt}</b>. Skipping ahead doesn't count — played time is read from YouTube's own data.</li>}
          <li><b>Reused proof.</b> Each playback session can be paid once. Screenshots or debug info shared in groups are detected even after cropping or resizing.</li>
          <li><b>Edited proof.</b> Altered numbers or pasted text are detected.</li>
          <li><b>Old proof.</b> Debug info must be copied right after watching.</li>
        </ul>
        <p className="small muted" style={{ marginTop: 8 }}>Verify here <b>before</b> you submit on the job site. If this page says NOT VERIFIED, the submission will be declined there too — fix it and re-verify first. Retrying is free.</p>
      </div>

      {keyword && (
        <div className="card">
          <h3>Your search keyword</h3>
          <div className="kw"><span id="kw">{keyword}</span><CopyBtn text={keyword} /></div>
          <p className="small muted">Search YouTube for exactly this text. Do not open the video from a direct link.</p>
        </div>
      )}

      <div className="card">
        <h3>Instructions</h3>
        {c.instructions ? <div style={{ whiteSpace: "pre-wrap" }}>{c.instructions}</div> : (
          <ol className="steps">
            <li>Open YouTube and search for the keyword above.</li>
            <li>Find the video <b>{c.video_title ?? c.video_id}</b>{c.channel_title ? <> by <b>{c.channel_handle ?? c.channel_title}</b></> : null} and open it.</li>
            <li>Watch it{minTxt ? <> for at least <b>{minTxt}</b></> : null} with the video playing.</li>
            <li>While it's still playing, tap the <b>⋮</b> / right-click the player → <b>Stats for nerds</b>.</li>
            {c.proof_mode !== "screenshot" && <li>Tap <b>Copy debug info</b> in that panel{c.proof_mode === "either" ? " (fastest)" : ""}, and paste it below.</li>}
            {c.proof_mode !== "text" && <li>{c.proof_mode === "either" ? "Or take" : "Take"} a screenshot where the lines <b>Video ID / sCPN</b> and <b>Viewport / Frames</b> are fully visible{c.proof_mode === "both" ? ", and upload it too" : ""}.</li>}
            <li>Verify below and copy your payout code into the job's proof box.</li>
          </ol>
        )}
      </div>

      <div className="card">
        <h3>Submit your proof</h3>
        <UploadForm slug={c.slug} src={src ?? null} workerRef={w ?? null} disabled={closed} mode={c.proof_mode ?? "either"} />
      </div>
      <p className="small muted">Only the panel reading and a small fingerprint are kept; screenshots and debug text are not stored after checking.</p>
    </div>
  );
}

