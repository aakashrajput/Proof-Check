"use client";
import { useState } from "react";

type Check = { key: string; label: string; state: "ok" | "fail" | "unknown"; detail?: string };
type Result = { status: "pass" | "fail" | "review"; reason: string; message: string; payout_code?: string; fix?: string; checks?: Check[];
  details?: { frames_total?: number | null; watch_seconds?: number | null; video_id?: string | null; source?: string } };
type Mode = "either" | "screenshot" | "text" | "both";

type VariantOpt = { id: number; label: string; title: string; thumb: string };
type AttestKey = "like" | "subscribe" | "comment";
const ATTEST_TEXT: Record<AttestKey, { label: string; hint: string; icon: string }> = {
  like: { label: "I liked the video", hint: "Tap 👍 under the video", icon: "👍" },
  subscribe: { label: "I subscribed to the channel", hint: "The button now reads “Subscribed”", icon: "🔔" },
  comment: { label: "I left a relevant comment", hint: "About the video’s topic — not just “nice video”", icon: "💬" },
};

export default function UploadForm({ slug, src, workerRef, disabled, mode, variants = [], attest = [] }: { slug: string; src: string | null; workerRef: string | null; disabled: boolean; mode: Mode; variants?: VariantOpt[]; attest?: AttestKey[] }) {
  const [variantId, setVariantId] = useState<number | null>(variants.length === 1 ? variants[0].id : null);
  const [attested, setAttested] = useState<Set<AttestKey>>(new Set());
  const attestOk = attest.every((k) => attested.has(k));
  const [files, setFiles] = useState<File[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Result | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [wref, setWref] = useState(workerRef ?? "");

  const showFiles = mode !== "text", showText = mode !== "screenshot";
  const proofOk = mode === "both" ? files.length > 0 && text.trim().length > 0
    : mode === "text" ? text.trim().length > 0 : mode === "screenshot" ? files.length > 0 : files.length > 0 || text.trim().length > 0;
  const workerOk = wref.trim().length >= 2;
  const canSubmit = proofOk && attestOk && workerOk;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true); setErr(null); setRes(null);
    const fd = new FormData();
    fd.set("slug", slug);
    if (src) fd.set("src", src);
    if (wref) fd.set("worker_ref", wref);
    if (text.trim()) fd.set("text", text.trim());
    if (variantId) fd.set("variant_id", String(variantId));
    if (attest.length) fd.set("attested", attest.filter((k) => attested.has(k)).join(","));
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
          placeholder={'Paste the "Copy debug info" text here. It starts with {"ns":"yt",…'} spellCheck={false} />
        {text.trim().length > 0 && (() => {
          const t = text.trim(); const startsOk = /^\{/.test(t) || /Video\s*ID/i.test(t); const hasIds = /"(cpn|docid|video_?id|vid)"|s?CPN|nonce/i.test(t); const endsOk = /\}\s*$/.test(t) || !/^\{/.test(t);
          return <p className={`small pastecheck ${startsOk && hasIds && endsOk ? "ok" : "bad"}`}>{startsOk && hasIds && endsOk ? "✓ Looks like complete debug info" : !startsOk && /"(c|cplayer|cplatform|cver)"\s*:/.test(t) ? "✗ This paste is cut off at the start. Use the panel's copy icon, not text selection." : startsOk && !endsOk ? "✗ This paste is cut off at the end — copy again with the panel's copy icon." : "✗ This doesn't look like complete debug info yet"}</p>;
        })()}
        <details className="hint">
          <summary>How do I get the debug info?</summary>
          <div className="hint-body">
            <div className="hint-col">
              <b>💻 Computer</b>
              <ol>
                <li>While the video is playing, <b>right-click</b> anywhere on the video.</li>
                <li>Click <b>Stats for nerds</b> in the menu — a small panel appears over the video.</li>
                <li>Click <b>Copy debug info</b> (bottom of that panel).</li>
                <li>Come back here and paste (<kbd>Ctrl</kbd>+<kbd>V</kbd> / <kbd>⌘</kbd>+<kbd>V</kbd>).</li>
              </ol>
            </div>
            <div className="hint-col">
              <b>📱 YouTube app (Android / iPhone)</b>
              <ol>
                <li>Tap the video once, then tap the <b>⚙️ gear</b> (or <b>⋮</b>) on the player.</li>
                <li>Tap <b>Stats for nerds</b>. If it's missing, turn it on once: profile → Settings → General → <i>Stats for nerds</i>.</li>
                <li>Tap the small <b>copy icon ⧉</b> in the panel's top-right corner. <b>Don't select the text by hand</b> — that copies only part of it.</li>
                <li>Long-press the box above → <b>Paste</b>. It starts with <span className="mono">{"{"}</span> and ends with <span className="mono">{"}"}</span>.</li>
              </ol>
            </div>
            <div className="hint-mock" aria-hidden="true">
              <div className="mock-menu"><span>Loop</span><span>Copy video URL</span><span>Copy video URL at current time</span><span>Copy embed code</span><span className="hl">Stats for nerds</span></div>
              <div className="mock-panel"><div>Video ID / sCPN <b>dQw4w9WgXcQ / 7KQM 2X9L …</b></div><div>Viewport / Frames <b>1280x720 / 2 dropped of 4312</b></div><div>Current / Optimal Res <b>1280x720@30</b></div><div className="mock-btn">Copy debug info</div></div>
            </div>
            <p className="small muted">Watch it done: <a href="https://youtu.be/_CZmpnAcYSw" target="_blank" rel="noreferrer">computer</a> · <a href="https://youtu.be/DiFh80eNYsM" target="_blank" rel="noreferrer">phone</a>. The text is ~1,500 characters; paste all of it without editing.</p>
          </div>
        </details>
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
      {variants.length > 1 && (<>
        <label>Which version did you see in YouTube search?</label>
        <div className="vcards">
          {variants.map((v) => (
            <label className="vcard" key={v.id}>
              <input type="radio" name="variant" checked={variantId === v.id} onChange={() => setVariantId(v.id)} />
              <img src={v.thumb} alt="" /><div className="vt"><b>{v.label}</b> · {v.title}</div>
            </label>
          ))}
        </div>
      </>)}
      {attest.length > 0 && (
        <div className={`attest ${attestOk ? "done" : ""}`}>
          <div className="attest-head"><b>Before you verify, confirm you did these</b><span className="small muted">{attested.size}/{attest.length}</span></div>
          {attest.map((k) => (
            <label key={k} className={`attest-row ${attested.has(k) ? "on" : ""}`}>
              <input type="checkbox" checked={attested.has(k)} disabled={disabled} onChange={(e) => setAttested((p) => { const n = new Set(p); if (e.target.checked) n.add(k); else n.delete(k); return n; })} />
              <span className="box" aria-hidden="true" />
              <span className="ico">{ATTEST_TEXT[k].icon}</span>
              <span className="txt"><b>{ATTEST_TEXT[k].label}</b><span className="small muted">{ATTEST_TEXT[k].hint}</span></span>
            </label>
          ))}
          <p className="small muted" style={{ margin: "6px 0 0" }}>The employer spot-checks these on YouTube. A false confirmation means the task is declined and you won't be paid.</p>
        </div>
      )}
      <label>Your worker username / ID <span className="bad">*</span> <span className="muted">— exactly as shown on the job site, so your task can be matched</span></label>
      <input value={wref} onChange={(e) => setWref(e.target.value)} placeholder="e.g. your SproutGigs username" required minLength={2} autoComplete="username" />
      <div style={{ marginTop: 12 }}>
        <button type="submit" disabled={busy || disabled || !canSubmit}>{busy ? "Verifying…" : "Verify proof"}</button>
        {proofOk && !workerOk && <span className="small muted" style={{ marginLeft: 10 }}>Enter your worker username to continue.</span>}
        {proofOk && workerOk && !attestOk && <span className="small muted" style={{ marginLeft: 10 }}>Tick all confirmations above to continue.</span>}
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
            {attest.length > 0 && <p className="small muted">You confirmed: {attest.map((k) => ATTEST_TEXT[k].label.replace(/^I /, "")).join(" · ")}.</p>}
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
          {res.details?.source && <p className="small muted" style={{ marginTop: 8 }}>checked via {res.details.source}{res.details?.watch_seconds != null ? ` · ${Math.round(res.details.watch_seconds)} s watched so far` : ""}</p>}
        </div>
      )}
    </form>
  );
}
