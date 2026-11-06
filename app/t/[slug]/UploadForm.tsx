"use client";
import { useState } from "react";

type Result = { status: "pass" | "fail" | "review"; reason: string; message: string; payout_code?: string;
  details?: { frames_total?: number | null; watch_seconds?: number | null; video_id?: string | null; source?: string } };
type Mode = "either" | "screenshot" | "text" | "both";

export default function UploadForm({ slug, src, workerRef, disabled, mode }: { slug: string; src: string | null; workerRef: string | null; disabled: boolean; mode: Mode }) {
  const [files, setFiles] = useState<File[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Result | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [wref, setWref] = useState(workerRef ?? "");

  const showFiles = mode !== "text", showText = mode !== "screenshot";
  const canSubmit = mode === "both" ? files.length > 0 && text.trim().length > 0
    : mode === "text" ? text.trim().length > 0 : mode === "screenshot" ? files.length > 0 : files.length > 0 || text.trim().length > 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true); setErr(null); setRes(null);
    const fd = new FormData();
    fd.set("slug", slug);
    if (src) fd.set("src", src);
    if (wref) fd.set("worker_ref", wref);
    if (text.trim()) fd.set("text", text.trim());
    files.slice(0, 2).forEach((f) => fd.append("file", f));
    try {
      const r = await fetch("/api/verify", { method: "POST", body: fd });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? r.statusText);
      setRes(j);
    } catch (e) { setErr(String((e as Error).message ?? e)); }
    finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit}>
      {showText && (<>
        <label>{mode === "both" ? "1. Debug info text (required)" : mode === "text" ? "Debug info text" : "Option A — paste debug info (fastest, most reliable)"}</label>
        <textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} disabled={disabled}
          placeholder={'In the player: ⋮ → Stats for nerds → "Copy debug info", then paste here. Starts with {"ns":"yt",…'} spellCheck={false} />
      </>)}
      {showFiles && (<>
        <label>{mode === "both" ? "2. Screenshot (required)" : mode === "screenshot" ? "Screenshot" : "Option B — upload a screenshot of the panel"}</label>
        <label className="drop">
          {files.length ? `${files.length} file(s) selected — tap to change` : "Tap to choose 1–2 screenshots (PNG/JPG)"}
          <input type="file" accept="image/*" multiple disabled={disabled} onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, 2))} />
        </label>
        {files.length > 0 && <div className="thumbs">{files.map((f, i) => <img key={i} src={URL.createObjectURL(f)} alt="" />)}</div>}
      </>)}
      {mode === "either" && <p className="small muted">You can send either one, or both — if both, they must be from the same playback.</p>}
      <label>Your worker ID / username (optional, helps the employer find you)</label>
      <input value={wref} onChange={(e) => setWref(e.target.value)} placeholder="e.g. your SproutGigs username" />
      <div style={{ marginTop: 12 }}>
        <button type="submit" disabled={busy || disabled || !canSubmit}>{busy ? "Verifying…" : "Verify proof"}</button>
      </div>
      {err && <div className="result fail">Error: {err}</div>}
      {res && (
        <div className={`result ${res.status}`}>
          <b>{res.status === "pass" ? "✓ VERIFIED" : res.status === "fail" ? "✗ NOT VERIFIED" : "⏳ SENT FOR REVIEW"}</b>
          <p>{res.message}</p>
          {res.payout_code && <>
            <div className="code">{res.payout_code}</div>
            <p className="small muted">Paste this code as your proof on the job page. It works once.</p>
          </>}
          {(res.details?.watch_seconds != null || res.details?.frames_total != null) && (
            <p className="small muted">
              {res.details?.watch_seconds != null ? `~${Math.round(res.details.watch_seconds)}s watched` : ""}
              {res.details?.frames_total != null ? ` · ${res.details.frames_total} frames` : ""}
              {res.details?.source ? ` · via ${res.details.source}` : ""}
            </p>
          )}
          {res.status === "fail" && <p className="small">Fix the issue above and try again.</p>}
        </div>
      )}
    </form>
  );
}
