"use client";
import { useEffect, useRef, useState } from "react";

type Meta = { videoId: string; title: string | null; channelTitle: string | null; channelHandle: string | null; durationSeconds: number | null;
  thumbnails: { default: string; medium: string; high: string; maxres: string }; source: string };
export type VariantDraft = { id?: number; label: "A" | "B" | "C"; title: string; thumb_url: string | null; thumb_data: string | null };

type Props = {
  action: (fd: FormData) => void | Promise<void>;
  mode: "create" | "edit";
  gemReady: boolean;
  initial?: { id?: number; name?: string; video_id?: string; video_title?: string | null; channel_title?: string | null; channel_handle?: string | null;
    min_seconds?: number; min_frames?: number; keywords?: string; instructions?: string; proof_mode?: string; sg_job_id?: string | null; attest?: string;
    duration_seconds?: number | null; thumbnail_url?: string | null; variants?: VariantDraft[] };
};

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export default function CampaignForm({ action, mode, gemReady, initial = {} }: Props) {
  const [video, setVideo] = useState(initial.video_id ?? "");
  const [meta, setMeta] = useState<Meta | null>(initial.video_id ? {
    videoId: initial.video_id, title: initial.video_title ?? null, channelTitle: initial.channel_title ?? null, channelHandle: initial.channel_handle ?? null,
    durationSeconds: initial.duration_seconds ?? null, source: "saved",
    thumbnails: { default: "", medium: `https://i.ytimg.com/vi/${initial.video_id}/mqdefault.jpg`, high: initial.thumbnail_url ?? `https://i.ytimg.com/vi/${initial.video_id}/hqdefault.jpg`, maxres: "" },
  } : null);
  const [lookup, setLookup] = useState<"idle" | "loading" | "error">("idle");
  const [minSeconds, setMinSeconds] = useState<number>(initial.min_seconds ?? 120);
  const minMinutes = Math.round((minSeconds / 60) * 100) / 100;
  const [variants, setVariants] = useState<VariantDraft[]>(initial.variants?.length ? initial.variants : [{ label: "A", title: initial.video_title ?? "", thumb_url: initial.thumbnail_url ?? null, thumb_data: null }]);
  const [askConfirm, setAskConfirm] = useState<boolean>(initial.attest === undefined ? true : (initial.attest ?? "").trim().length > 0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastId = useRef<string | null>(initial.video_id ?? null);

  // Debounced lookup when the URL changes
  useEffect(() => {
    const id = (video.match(/(?:v=|youtu\.be\/|shorts\/|embed\/|live\/)([A-Za-z0-9_-]{11})/)?.[1]) ?? (/^[A-Za-z0-9_-]{11}$/.test(video.trim()) ? video.trim() : null);
    if (!id || id === lastId.current) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setLookup("loading");
      try {
        const r = await fetch(`/api/youtube/lookup?v=${encodeURIComponent(id)}`);
        if (!r.ok) throw new Error();
        const m: Meta = await r.json();
        lastId.current = id; setMeta(m); setLookup("idle");
        // Prefill variant A from YouTube unless the employer already typed something
        setVariants((vs) => vs.map((v, i) => i === 0 && (!v.title || v.title === initial.video_title) ? { ...v, title: m.title ?? v.title, thumb_url: v.thumb_data ? v.thumb_url : m.thumbnails.high } : v));
        if (m.durationSeconds && mode === "create") setMinSeconds(Math.max(30, Math.min(m.durationSeconds, Math.round(m.durationSeconds * 0.5 / 10) * 10)));
      } catch { setLookup("error"); setMeta(null); }
    }, 500);
  }, [video, mode, initial.video_title]);

  function setVariant(i: number, patch: Partial<VariantDraft>) { setVariants((vs) => vs.map((v, j) => (j === i ? { ...v, ...patch } : v))); }
  function addVariant() { if (variants.length < 3) setVariants((vs) => [...vs, { label: (["A", "B", "C"] as const)[vs.length], title: "", thumb_url: null, thumb_data: null }]); }
  function removeVariant(i: number) { setVariants((vs) => vs.filter((_, j) => j !== i).map((v, j) => ({ ...v, label: (["A", "B", "C"] as const)[j] }))); }

  async function onThumb(i: number, file: File | undefined) {
    if (!file) return;
    const data = await resizeToJpeg(file, 640, 360, 0.82);
    setVariant(i, { thumb_data: data, thumb_url: null });
  }

  const variantsJson = JSON.stringify(variants.map((v) => ({ ...v, title: v.title.trim() })).filter((v) => v.title || v.thumb_data || v.thumb_url));

  return (
    <form className="card" action={action}>
      <h2>{mode === "create" ? "New campaign" : "Edit campaign"}</h2>
      {initial.id && <input type="hidden" name="id" value={initial.id} />}
      <input type="hidden" name="variants_json" value={variantsJson} />
      <input type="hidden" name="duration_seconds" value={meta?.durationSeconds ?? ""} />
      <input type="hidden" name="thumbnail_url" value={meta?.thumbnails.high ?? ""} />

      <div className="row">
        <div><label htmlFor="name">Name</label><input id="name" name="name" required defaultValue={initial.name ?? ""} placeholder="Nov promo — video 3" /></div>
        <div><label htmlFor="video">YouTube video URL or ID</label><input id="video" name="video" required value={video} onChange={(e) => setVideo(e.target.value)} placeholder="https://youtu.be/…" autoComplete="off" /></div>
      </div>

      {lookup === "loading" && <p className="small muted">Looking up video…</p>}
      {lookup === "error" && <p className="small" style={{ color: "var(--bad)" }}>Couldn't find that video. Check the URL.</p>}
      {meta && (
        <div className="preview">
          <img src={meta.thumbnails.high} alt="" width={160} height={90} />
          <div style={{ minWidth: 0 }}>
            <b style={{ display: "block", overflowWrap: "anywhere" }}>{meta.title ?? meta.videoId}</b>
            <span className="small muted">{meta.channelHandle ?? meta.channelTitle ?? "channel unknown"}{meta.durationSeconds ? ` · ${fmt(meta.durationSeconds)}` : ""} · <span className="mono">{meta.videoId}</span></span>
            {!meta.durationSeconds && <div className="small muted">Duration needs a YouTube API key on the server; everything else works without it.</div>}
          </div>
        </div>
      )}

      <div className="row">
        <div><label htmlFor="min_minutes">Minimum watch time (minutes){meta?.durationSeconds ? <span className="muted"> — video is {fmt(meta.durationSeconds)}</span> : null}</label>
          <div className="withunit">
            <input id="min_minutes" type="number" min={0} step={0.5} value={minMinutes} onChange={(e) => setMinSeconds(Math.round((Number(e.target.value) || 0) * 60))} />
            <span className="unit">min{minSeconds ? <> = {fmt(minSeconds)}</> : null}</span>
          </div>
          <input type="hidden" name="min_seconds" value={minSeconds} />
          <div className="chips" style={{ marginTop: 6 }}>
            {[1, 2, 3, 5].map((m) => <button type="button" key={m} className="chip" onClick={() => setMinSeconds(m * 60)}>{m} min</button>)}
            {meta?.durationSeconds ? <button type="button" className="chip" onClick={() => setMinSeconds(Math.round(meta.durationSeconds! * 0.5))}>half the video</button> : null}
            {meta?.durationSeconds ? <button type="button" className="chip" onClick={() => setMinSeconds(Math.max(0, meta.durationSeconds! - 10))}>almost all</button> : null}
          </div>
          {meta?.durationSeconds && minSeconds > meta.durationSeconds && <div className="small" style={{ color: "var(--bad)" }}>Longer than the video — nobody can pass.</div>}
        </div>
        <div><label htmlFor="min_frames">Minimum frames (optional, used when fps isn't readable)</label><input id="min_frames" name="min_frames" type="number" min={0} defaultValue={initial.min_frames ?? 0} /></div>
      </div>

      <h3 style={{ marginTop: 18 }}>Title &amp; thumbnail variants <span className="muted" style={{ textTransform: "none", letterSpacing: 0 }}>— shown to workers so they recognise the video; they tell you which one they saw</span></h3>
      <div className="variants">
        {variants.map((v, i) => (
          <div className="variant" key={v.label}>
            <div className="vhead"><span className="pill active">{v.label}</span>{i === 0 ? <span className="small muted">current on YouTube</span> : <button type="button" className="secondary small" onClick={() => removeVariant(i)}>Remove</button>}</div>
            <label className="thumbdrop">
              {v.thumb_data || v.thumb_url ? <img src={v.thumb_data ?? v.thumb_url ?? ""} alt="" /> : <span className="small muted">Tap to upload thumbnail (16:9)</span>}
              <input type="file" accept="image/*" onChange={(e) => onThumb(i, e.target.files?.[0])} />
            </label>
            <input value={v.title} onChange={(e) => setVariant(i, { title: e.target.value })} placeholder={`Title ${v.label}`} maxLength={120} />
            {(v.thumb_data || (v.thumb_url && i > 0)) && <button type="button" className="secondary small" style={{ marginTop: 6 }} onClick={() => setVariant(i, { thumb_data: null, thumb_url: i === 0 ? (meta?.thumbnails.high ?? null) : null })}>Reset thumbnail</button>}
          </div>
        ))}
        {variants.length < 3 && <button type="button" className="secondary addv" onClick={addVariant}>+ Add variant {(["A", "B", "C"] as const)[variants.length]}</button>}
      </div>

      <h3 style={{ marginTop: 18 }}>Engagement confirmation</h3>
      <label className="switch">
        <input type="checkbox" checked={askConfirm} onChange={(e) => setAskConfirm(e.target.checked)} />
        <span className="track" aria-hidden="true" />
        <span><b>Ask workers to confirm engagement before verifying</b><span className="small muted" style={{ display: "block" }}>Shows a glowing checklist (like / subscribe / comment) that must be ticked before the Verify button works. Self-declared and recorded on each submission for spot-checks. Off = the block is hidden.</span></span>
      </label>
      <div className="attest-opts" style={{ opacity: askConfirm ? 1 : .4, marginLeft: 46 }}>
        {([["like", "Liked the video"], ["subscribe", "Subscribed to the channel"], ["comment", "Left a relevant comment"]] as const).map(([k, l]) => (
          <label key={k} className="attest-opt"><input type="checkbox" name="attest" value={k} disabled={!askConfirm} defaultChecked={(initial.attest === undefined ? "like,subscribe,comment" : initial.attest ?? "").split(",").includes(k)} /> {l}</label>
        ))}
      </div>

      <label htmlFor="keywords">Search keywords — one per line, rotated evenly across workers</label>
      <textarea id="keywords" name="keywords" rows={4} defaultValue={initial.keywords ?? ""} placeholder={"best budget phone 2026 review\nbudget phone camera test"} />
      <label htmlFor="instructions">Custom instructions (optional — a default step list is shown if blank)</label>
      <textarea id="instructions" name="instructions" rows={3} defaultValue={initial.instructions ?? ""} />
      <div className="row">
        <div><label htmlFor="proof_mode">Accepted proof</label>
          <select id="proof_mode" name="proof_mode" defaultValue={initial.proof_mode ?? (gemReady ? "either" : "text")}>
            <option value="either">Debug-info text OR screenshot</option>
            <option value="text">Debug-info text only (no AI cost)</option>
            <option value="screenshot" disabled={!gemReady}>Screenshot only{gemReady ? "" : " (needs GEMINI_API_KEY)"}</option>
            <option value="both" disabled={!gemReady}>Both required{gemReady ? "" : " (needs GEMINI_API_KEY)"}</option>
          </select></div>
        <div><label htmlFor="sg_job_id">SproutGigs job ID (optional — enables auto-rating)</label><input id="sg_job_id" name="sg_job_id" defaultValue={initial.sg_job_id ?? ""} placeholder="e.g. 123456" /></div>
      </div>
      <div style={{ marginTop: 12 }}><button type="submit">{mode === "create" ? "Create campaign" : "Save changes"}</button></div>
    </form>
  );
}

function resizeToJpeg(file: File, maxW: number, maxH: number, q: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxW / img.width, maxH / img.height);
      const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      c.getContext("2d")!.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL("image/jpeg", q));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("bad image")); };
    img.src = url;
  });
}
