"use client";
import { useState } from "react";
import Details from "./Details";

type Sub = Parameters<typeof Details>[0]["sub"];
type Props = { sub: Sub; campaignId: number; campaignVideo: string; minSeconds: number; variantLabel: string | null; override: (fd: FormData) => void | Promise<void>; colSpan: number };

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s) % 60).padStart(2, "0")}`;
const humanDur = (sec: number) => { sec = Math.max(0, Math.round(sec)); const m = Math.floor(sec / 60), s = sec % 60; return m ? (s ? `${m} min ${s} s` : `${m} min`) : `${s} s`; };

export default function SubRow({ sub: s, campaignId, campaignVideo, minSeconds, variantLabel, override, colSpan }: Props) {
  const [open, setOpen] = useState(false);
  const more = s.watch_seconds != null && minSeconds > 0 && s.watch_seconds < minSeconds ? Math.ceil(minSeconds - s.watch_seconds) : 0;
  let note: string | null = null;
  try { note = s.raw_json ? (JSON.parse(s.raw_json).note ?? null) : null; } catch { note = null; }
  return (
    <>
      <tr className={open ? "open" : ""}>
        <td><b>{s.worker_ref ?? "—"}</b>{s.src ? <span className={`src ${s.src}`}>{s.src}</span> : null}<div className="small muted">#{s.id} · via {s.source ?? "—"}{s.attempts > 1 ? ` · ${s.attempts} attempts` : ""}</div></td>
        <td><span className={`pill ${s.status}`}>{s.status}</span><div className="small muted reason">{s.reason}{note && /unreadable sample/.test(note) ? <div className="small warn">see Details → raw text</div> : null}</div></td>
        <td className="nowrap">{s.watch_seconds != null ? <><b>{mmss(s.watch_seconds)}</b>{minSeconds ? <span className="muted"> / {mmss(minSeconds)}</span> : null}{more ? <div className="small bad">{humanDur(more)} short</div> : null}</> : s.frames_total != null ? `${s.frames_total} fr` : s.reason === "second_paste_needed" ? <span className="small warn">timer running</span> : "—"}</td>
        <td className="small"><span className={`mono ${s.video_id_read && s.video_id_read !== campaignVideo ? "bad" : ""}`}>{s.video_id_read ?? "—"}</span>{s.scpn ? <div className="mono muted">{s.scpn.slice(0, 10)}…</div> : null}</td>
        <td title={s.attested ?? ""}>{s.attested ? s.attested.split(",").map((a) => a === "like" ? "👍" : a === "subscribe" ? "🔔" : "💬").join(" ") : "—"}</td>
        <td className="small">{variantLabel ?? "—"}</td>
        <td className="mono nowrap">{s.payout_code ?? "—"}</td>
        <td className="small muted nowrap">{(s.updated_at ?? s.created_at).slice(5, 16)}</td>
        <td className="actions">
          <button type="button" className="secondary" onClick={() => setOpen((o) => !o)} aria-expanded={open}>{open ? "Hide" : "Details"}</button>
          {s.status !== "pass" && <form action={override}><input type="hidden" name="submission_id" value={s.id} /><input type="hidden" name="campaign_id" value={campaignId} /><input type="hidden" name="to" value="pass" /><button className="secondary">Approve</button></form>}
          {s.status !== "fail" && <form action={override}><input type="hidden" name="submission_id" value={s.id} /><input type="hidden" name="campaign_id" value={campaignId} /><input type="hidden" name="to" value="fail" /><button className="secondary">Reject</button></form>}
        </td>
      </tr>
      {open && <tr className="details-row"><td colSpan={colSpan}><Details sub={s} campaignVideo={campaignVideo} minSeconds={minSeconds} embedded /></td></tr>}
    </>
  );
}
