"use client";
import { useEffect, useState } from "react";

type S = { found: boolean; status?: string; reason?: string; message?: string; next?: string | null; payout_code?: string | null; watched_seconds?: number | null; needed_seconds?: number; attempts?: number; updated_at?: string };
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s) % 60).padStart(2, "0")}`;

export default function Status({ slug, initialWorker }: { slug: string; initialWorker: string | null }) {
  const [w, setW] = useState(initialWorker ?? "");
  const [res, setRes] = useState<S | null>(null);
  const [busy, setBusy] = useState(false);
  const [auto, setAuto] = useState(false);

  async function check(name = w) {
    if (name.trim().length < 2) return;
    setBusy(true);
    try { const r = await fetch(`/api/status?slug=${encodeURIComponent(slug)}&w=${encodeURIComponent(name.trim())}`); setRes(await r.json()); }
    catch { setRes({ found: false, message: "Couldn't check right now. Try again." }); }
    finally { setBusy(false); }
  }
  // Remember the worker on this device and show their status automatically when they come back.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(`pc_worker_${slug}`);
      if (!w && saved) { setW(saved); setAuto(true); void check(saved); }
    } catch { /* storage unavailable */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="status">
      <div className="status-head"><b>Already submitted? Check your status</b><span className="small muted">Shows your latest result and your code — including approvals the employer did by hand.</span></div>
      <form className="status-form" onSubmit={(e) => { e.preventDefault(); void check(); }}>
        <input value={w} onChange={(e) => setW(e.target.value)} placeholder="your worker username" minLength={2} />
        <button type="submit" className="secondary" disabled={busy || w.trim().length < 2}>{busy ? "Checking…" : "Check"}</button>
      </form>
      {res && (
        <div className={`result ${res.found ? res.status : "review"}`} style={{ marginTop: 10 }}>
          {res.found ? (<>
            <b>{res.status === "pass" ? "✓ VERIFIED" : res.status === "review" ? "⏳ IN REVIEW" : "✗ NOT VERIFIED YET"}{auto ? <span className="small muted" style={{ fontWeight: 400 }}> · welcome back, {w}</span> : null}</b>
            <p>{res.message}</p>
            {res.payout_code && <><div className="code">{res.payout_code}</div><p className="small muted">Paste this code as your proof on the job site. It works once.</p></>}
            {res.watched_seconds != null && res.needed_seconds ? <p className="small muted">{mmss(res.watched_seconds)} watched of {mmss(res.needed_seconds)}{res.attempts && res.attempts > 1 ? ` · ${res.attempts} attempts` : ""}</p> : null}
            {res.next && <p className="small">{res.next}</p>}
          </>) : <p>{res.message}</p>}
        </div>
      )}
    </div>
  );
}
