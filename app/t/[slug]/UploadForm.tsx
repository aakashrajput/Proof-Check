"use client";
import { useState } from "react";

type Check = { key: string; label: string; state: "ok" | "fail" | "unknown"; detail?: string };
type Result = { status: "pass" | "fail" | "review"; reason: string; message: string; payout_code?: string; fix?: string; checks?: Check[];
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
        <div className={`result ${res.status}`} role="status" aria-live="polite">
          <b>{res.status === "pass" ? "✓ VERIFIED" : res.status === "fail" ? "✗ NOT VERIFIED — don't submit this on the job site yet" : "⏳ SENT FOR REVIEW"}</b>
          <p>{res.message}</p>
          {res.checks && res.checks.length > 0 && (
            <ul className="checks">
              {res.checks.map((k) => (
                <li key={k.key} className={k.state === "ok" ? "ok" : k.state === "fail" ? "bad" : "unknown"}>
                  {k.state === "ok" ? "✓" : k.state === "fail" ? "✗" : "?"} {k.label}{k.detail ? <span className="muted"> — {k.detail}</span> : null}
                </li>
              ))}
            </ul>
          )}
          {res.payout_code && <>
            <div className="code">{res.payout_code}</div>
            <p className="small muted">Paste this code as your proof on the job page. It works once — don't share it.</p>
          </>}
          {res.status === "fail" && (
            <div className="warnbox">
              <b>What to do:</b> {res.fix ?? "Fix the item marked ✗ above, then verify again."}
              <div className="muted" style={{ marginTop: 6 }}>If you submit this proof on the job site as it is, it will be declined and you won't be paid. Verify again here first — it's free to retry.</div>
            </div>
          )}
          {res.status === "review" && (
            <div className="warnbox">
              <b>What this means:</b> the employer will look at it by hand, which can take a while. {res.fix ?? ""} If you can, paste the "Copy debug info" text for an instant result instead.
            </div>
          )}
          {res.details?.source && <p className="small muted" style={{ marginTop: 8 }}>checked via {res.details.source}</p>}
        </div>
      )}
    </form>
  );
}
