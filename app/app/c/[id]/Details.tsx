"use client";
import { useState } from "react";

type Props = { sub: { id: number; status: string; reason: string; source: string | null; video_id_read: string | null; scpn: string | null; frames_total: number | null; frames_dropped: number | null; fps: number | null;
  watch_seconds: number | null; played_seconds: number | null; attempts: number; created_at: string; updated_at: string | null; attested: string | null; worker_ref: string | null; src: string | null; raw_json: string | null; payout_code: string | null };
  campaignVideo: string; minSeconds: number; embedded?: boolean };

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s) % 60).padStart(2, "0")}`;

export default function Details({ sub, campaignVideo, minSeconds, embedded = false }: Props) {
  const [open, setOpen] = useState(embedded);
  const [copied, setCopied] = useState(false);
  let j: { read?: Record<string, unknown> | null; text?: Record<string, unknown> | null; raw?: string | null; note?: string | null } = {};
  try { j = sub.raw_json ? JSON.parse(sub.raw_json) : {}; } catch { j = {}; }
  const t = j.text ?? null, r = j.read ?? null;
  const row = (k: string, v: unknown, cls = "") => v === null || v === undefined || v === "" ? null : <div className="dl-row" key={k}><span className="dl-k">{k}</span><span className={`dl-v ${cls}`}>{String(v)}</span></div>;

  return (
    <>
      {!embedded && <button type="button" className="secondary" onClick={() => setOpen((o) => !o)}>{open ? "Hide" : "Details"}</button>}
      {open && (
        <div className="details-panel">
          <div className="dl">
            {row("Verdict", `${sub.status} · ${sub.reason}`, sub.status === "pass" ? "ok" : sub.status === "fail" ? "bad" : "warn")}
            {row("Worker", `${sub.worker_ref ?? "—"}${sub.src ? ` (from ${sub.src})` : ""}`)}
            {row("Proof via", `${sub.source ?? "—"}${t ? ` · format: ${String(t.format)}${t.platform ? ` · ${String(t.platform)}` : ""}` : ""}${r ? ` · screenshot platform: ${String(r.platform)}` : ""}`)}
            {row("Video in proof", sub.video_id_read ? `${sub.video_id_read} ${sub.video_id_read === campaignVideo ? "✓ matches" : "✗ campaign is " + campaignVideo}` : "not readable", sub.video_id_read ? (sub.video_id_read === campaignVideo ? "ok" : "bad") : "warn")}
            {row("Playback ID (cpn)", sub.scpn ?? "not readable", sub.scpn ? "" : "warn")}
            {row("Watched", sub.watch_seconds != null ? `${mmss(sub.watch_seconds)} (${Math.round(sub.watch_seconds)} s)${minSeconds ? ` · needs ${mmss(minSeconds)}` : ""}` : "unknown — no watch-time fields in this proof", sub.watch_seconds != null ? (minSeconds && sub.watch_seconds < minSeconds ? "bad" : "ok") : "warn")}
            {t && row("Played ranges (vpl)", t.played_seconds != null ? `${t.played_seconds} s` : null)}
            {t && row("Playhead (vct)", t.vct != null ? `${t.vct} s` : null)}
            {t && row("Video length", t.duration != null ? `${mmss(Number(t.duration))}` : null)}
            {row("Frames", sub.frames_total != null ? `${sub.frames_total} total${sub.frames_dropped != null ? `, ${sub.frames_dropped} dropped` : ""}${sub.fps ? ` @ ${sub.fps} fps` : ""}` : null)}
            {t && t.timestamp_ms ? row("Debug info copied at", new Date(Number(t.timestamp_ms)).toISOString().replace("T", " ").slice(0, 19) + " UTC") : null}
            {row("First seen", sub.created_at + " UTC")}
            {row("Last update", sub.updated_at ? sub.updated_at + " UTC" : null)}
            {row("Attempts", sub.attempts)}
            {row("Worker confirmed", sub.attested ? sub.attested.split(",").join(", ") : "—")}
            {row("Payout code", sub.payout_code)}
            {r && row("Screenshot read", `panel ${r.has_stats_panel ? "visible" : "not visible"} · confidence ${r.confidence} · ${r.looks_edited ? "looks edited" : "no edit signs"}${r.edit_notes ? ` · ${String(r.edit_notes)}` : ""}`)}
            {j.note && row("Note", j.note)}
          </div>
          {j.raw && (
            <div style={{ marginTop: 10 }}>
              <div className="dl-k" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>Raw text the worker pasted</span>
                <button type="button" className="secondary" style={{ padding: "3px 8px", fontSize: 12 }} onClick={async () => { try { await navigator.clipboard.writeText(j.raw ?? ""); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ } }}>{copied ? "Copied" : "Copy"}</button>
              </div>
              <pre className="term" style={{ maxHeight: 220, overflow: "auto", fontSize: 11.5, marginTop: 6 }}>{j.raw}</pre>
            </div>
          )}
          {!j.raw && !r && <p className="small muted" style={{ marginTop: 8 }}>No raw proof stored for this row (submitted before raw text was kept).</p>}
          <p className="small muted" style={{ marginTop: 8 }}>How to judge a <b>review</b>: video matches + playback ID present + a believable copied-at time close to “first seen” → Approve. Watched unknown and nothing else to go on → ask the worker to paste again (the timer flow now handles this automatically for new submissions).</p>
        </div>
      )}
    </>
  );
}
