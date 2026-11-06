import { notFound } from "next/navigation";
import { one, q, run, parseAttest, type Campaign, type Variant } from "@/lib/db";
import UploadForm from "./UploadForm";
import CopyBtn from "./Copy";
import NotFound from "./NotFound";
import Status from "./Status";

export const dynamic = "force-dynamic";

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

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

  const variants = await q<Variant>("SELECT id, label, title, thumb_url, thumb_data FROM campaign_variants WHERE campaign_id = ? ORDER BY position", [c.id]);
  const closed = c.status !== "active";
  const minTxt = c.min_seconds ? `${fmt(c.min_seconds)} min` : c.min_frames ? `${c.min_frames} frames` : null;
  const fallbackThumb = `https://i.ytimg.com/vi/${c.video_id}/hqdefault.jpg`;
  const heroThumb = variants[0]?.thumb_data ?? variants[0]?.thumb_url ?? c.thumbnail_url ?? fallbackThumb;
  const title = c.video_title ?? c.video_id;
  const channel = c.channel_handle ?? c.channel_title;
  const mode = c.proof_mode ?? "either";
  const showSteps = c.show_instructions !== 0;
  const stepBase = (variants.length ? 1 : 0) + (keyword ? 1 : 0);
  const vopts = variants.map((v) => ({ id: v.id, label: v.label, title: v.title || title, thumb: v.thumb_data ?? v.thumb_url ?? `https://i.ytimg.com/vi/${c.video_id}/mqdefault.jpg` }));

  return (
    <div className="tpage">
      <header className="tnav">
        <div className="tnav-in">
          <div className="brand">Proof<span>Check</span></div>
          <div className="tnav-right">
            <span className={`pill ${closed ? "fail" : "pass"}`}>{closed ? "closed" : "open"}</span>
            <span className="small muted">task {c.slug}</span>
          </div>
        </div>
      </header>

      <section className="thero" style={{ ["--hero" as string]: `url("${heroThumb}")` }}>
        <div className="thero-in">
          <div className="thero-media">
            <img src={heroThumb} alt="" width={480} height={270} />
            {c.duration_seconds ? <span className="dur">{fmt(c.duration_seconds)}</span> : null}
          </div>
          <div className="thero-text">
            <p className="eyebrow">YouTube watch task · {c.name}</p>
            <h1>{title}</h1>
            {channel && <p className="chan">by <b>{channel}</b></p>}
            <div className="kpis">
              {minTxt && <span><Ico k="clock" /> Watch at least <b>{minTxt}</b></span>}
              <span><Ico k="bolt" /> Result in seconds</span>
              <span><Ico k="key" /> One-time payout code</span>
            </div>
            {closed && <p className="closed-note">This task is currently closed and isn't accepting proof.</p>}
          </div>
        </div>
      </section>

      <main className="tgrid">
        <div className="tleft">
          {variants.length > 0 && (
            <section className="tcard">
              <h2><span className="n">1</span> Recognise the video</h2>
              <p className="muted small">{variants.length > 1 ? "YouTube shows different people different titles and thumbnails. Any of these is the right video — you'll tell us which one you saw." : "This is how it appears in search results."}</p>
              <div className="vcards big">
                {vopts.map((v) => <div className="vcard" key={v.id} style={{ cursor: "default" }}><img src={v.thumb} alt="" /><div className="vt"><span className="vl">{v.label}</span>{v.title}</div></div>)}
              </div>
            </section>
          )}

          {keyword && (
            <section className="tcard kwcard">
              <h2><span className="n">{variants.length ? 2 : 1}</span> Search this keyword on YouTube</h2>
              <div className="kw big"><span id="kw">{keyword}</span><CopyBtn text={keyword} /></div>
              <p className="small muted">Type it exactly as shown and open the video <b>from the search results</b>, not from a link. {c.channel_title ? <>Check the channel is <b>{channel}</b>.</> : null}</p>
              <NotFound slug={c.slug} keyword={keyword} src={src ?? null} workerRef={w ?? null} channel={channel} title={title} />
            </section>
          )}

          {showSteps && <section className="tcard">
            <h2><span className="n">{stepBase + 1}</span> Watch, then copy your proof</h2>
            {c.instructions ? <div className="custom-steps">{c.instructions}</div> : (
              <ol className="timeline">
                <li><b>Play the video{minTxt ? <> for at least {minTxt}</> : null}.</b><span>Muted or in another tab is fine. Skipping ahead doesn't count — played time comes from YouTube's own data.</span></li>
                <li><b>While it's still playing, open Stats for nerds.</b><span>Mobile: tap <kbd>⋮</kbd> on the player → <i>Stats for nerds</i>. Computer: right-click the player → <i>Stats for nerds</i>.</span></li>
                {mode !== "screenshot" && <li><b>Tap <i>Copy debug info</i>{mode === "either" ? " (fastest)" : ""}.</b><span>Paste the whole text into the proof box{mode === "both" ? ", and also" : ". Or, if there's no copy button,"} take a screenshot where <i>Video ID / sCPN</i> and <i>Viewport / Frames</i> are fully visible.</span></li>}
                {mode === "screenshot" && <li><b>Take a screenshot of the panel.</b><span>The lines <i>Video ID / sCPN</i> and <i>Viewport / Frames</i> must be fully visible.</span></li>}
                {parseAttest(c.attest).length > 0 && <li><b>Like, subscribe and comment as asked.</b><span>You'll confirm each one before verifying. The employer spot-checks these — a false confirmation gets the task declined.</span></li>}
                <li><b>Press Verify.</b><span>You'll see exactly what passed. Only after <b className="ok">✓ VERIFIED</b> paste your <span className="mono">pw-</span> code into the job's proof box.</span></li>
              </ol>
            )}
            <div className="helplinks small muted">How to open Stats for nerds: <a href="https://youtu.be/DiFh80eNYsM" target="_blank" rel="noreferrer">📱 phone</a> · <a href="https://youtu.be/_CZmpnAcYSw" target="_blank" rel="noreferrer">💻 computer</a></div>
          </section>}

          <section className="tcard rules">
            <h2>What gets a proof declined</h2>
            <div className="rulegrid">
              <div className="rule"><Ico k="video" /><div><b>Wrong video</b><span>Proof must come from <i>{title}</i>{channel ? <> by {channel}</> : null}.</span></div></div>
              {minTxt && <div className="rule"><Ico k="clock" /><div><b>Too short</b><span>Under {minTxt} of real playback. Scrubbing to the end doesn't count.</span></div></div>}
              <div className="rule"><Ico k="repeat" /><div><b>Reused proof</b><span>Each playback session pays once. Shared screenshots or debug info are caught even after cropping or resizing.</span></div></div>
              <div className="rule"><Ico k="edit" /><div><b>Edited proof</b><span>Altered numbers or pasted text are detected.</span></div></div>
              <div className="rule"><Ico k="hourglass" /><div><b>Old proof</b><span>Copy the debug info right after watching, not hours later.</span></div></div>
              <div className="rule"><Ico k="shield" /><div><b>Verify first</b><span>If this page says NOT VERIFIED, the job site will decline it too. Fix it and retry here — it's free.</span></div></div>
            </div>
          </section>
        </div>

        <aside className="tright">
          <section className="tcard submit">
            <h2><span className="n accent">{stepBase + (showSteps ? 2 : 1)}</span> Submit your proof</h2>
            <UploadForm slug={c.slug} src={src ?? null} workerRef={w ?? null} disabled={closed} mode={mode} variants={vopts} attest={parseAttest(c.attest)} />
          </section>
          <section className="tcard"><Status slug={c.slug} initialWorker={w ?? null} /></section>
          <p className="small muted privacy">Only the panel reading and your pasted text are kept for the employer's review. Screenshots are discarded after checking.</p>
        </aside>
      </main>
    </div>
  );
}

function Ico({ k }: { k: string }) {
  const p: Record<string, string> = {
    clock: "M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z",
    bolt: "M13 3 4 14h7l-1 7 9-11h-7l1-7z",
    key: "M15 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm0 0-9 9v3h3v-2h2v-2h2l2-2",
    video: "M4 6h12v12H4zM16 10l5-3v10l-5-3",
    repeat: "M17 2l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3",
    edit: "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z",
    hourglass: "M6 2h12M6 22h12M7 2v4l5 6 5-6V2M7 22v-4l5-6 5 6v4",
    shield: "M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-4zM9 12l2 2 4-4",
  };
  return <svg className="ico" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={p[k]} /></svg>;
}
