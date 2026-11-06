"use client";
import { useState } from "react";

export default function NotFound({ slug, keyword, src, workerRef, channel, title }: { slug: string; keyword: string | null; src: string | null; workerRef: string | null; channel: string | null; title: string }) {
  const [open, setOpen] = useState(false);
  const [wref, setWref] = useState(workerRef ?? "");
  const [note, setNote] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");

  async function send() {
    if (wref.trim().length < 2) return;
    setState("busy");
    try {
      const r = await fetch("/api/report", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug, kind: "not_found", worker_ref: wref.trim(), src, keyword, note }) });
      setState(r.ok ? "done" : "error");
    } catch { setState("error"); }
  }

  if (state === "done") return (
    <div className="nf done">
      <b>Thanks — reported.</b>
      <p className="small">Before you give up, try these — they solve it most of the time:</p>
      <ul className="small">
        <li>In YouTube search, tap <b>Filters</b> → <b>Upload date: This week</b>, then scroll — new videos rarely sit at the top.</li>
        <li>Look for the thumbnails shown at the top of this page; the title may differ slightly.</li>
        {channel && <li>Search the channel name <b>{channel}</b> and open the video from its channel page.</li>}
        <li>Try the keyword without quotes, or with one extra word from the title <i>“{title.split(" ").slice(0, 3).join(" ")}…”</i>.</li>
      </ul>
      <p className="small muted">If you find it after all, just come back and submit proof as normal.</p>
    </div>
  );

  return (
    <div className="nf">
      {!open ? (
        <button type="button" className="secondary" onClick={() => setOpen(true)}>I couldn't find the video on YouTube</button>
      ) : (
        <div className="nf-form">
          <b>Couldn't find it? Tell the employer.</b>
          <p className="small muted">This is recorded against the keyword you were shown{keyword ? <>: <span className="mono">{keyword}</span></> : null}. It doesn't earn a payout, but it helps fix the task for everyone.</p>
          <label>Your worker username / ID <span className="bad">*</span></label>
          <input value={wref} onChange={(e) => setWref(e.target.value)} placeholder="as shown on the job site" minLength={2} />
          <label>What did you see? (optional)</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. only old videos from other channels showed up" maxLength={500} />
          <div className="actions" style={{ marginTop: 10 }}>
            <button type="button" onClick={send} disabled={state === "busy" || wref.trim().length < 2}>{state === "busy" ? "Sending…" : "Send report"}</button>
            <button type="button" className="secondary" onClick={() => setOpen(false)}>Cancel</button>
          </div>
          {state === "error" && <p className="small bad">Couldn't send. Try again in a moment.</p>}
        </div>
      )}
    </div>
  );
}
