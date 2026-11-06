// Parses text proof: YouTube "Stats for nerds → Copy debug info" JSON (desktop & mobile),
// or the panel's lines pasted as plain text.

export type TextRead = {
  video_id: string | null;
  scpn: string | null;
  frames_total: number | null;
  frames_dropped: number | null;
  fps: number | null;
  vct: number | null;            // current playhead, seconds
  duration: number | null;       // video length, seconds
  played_seconds: number | null; // sum of played ranges (vpl) — true watch time, skips excluded
  timestamp_ms: number | null;   // when the debug info was copied
  platform: string | null;
  format: "json" | "ios" | "lines" | "unknown";
  problems: string[];
};

const ID = /^[A-Za-z0-9_-]{11}$/;
const CPN = /^[A-Za-z0-9_-]{12,24}$/;

// itags that are 60fps (used only as a fallback fps hint)
const FPS60 = new Set([298, 299, 302, 303, 308, 315, 334, 335, 336, 337, 394, 395, 396, 397, 398, 399, 400, 401, 402, 571, 694, 695, 696, 697, 698, 699, 700, 701, 702]);

export function parseDebugText(input: string): TextRead {
  const out: TextRead = { video_id: null, scpn: null, frames_total: null, frames_dropped: null, fps: null, vct: null, duration: null,
    played_seconds: null, timestamp_ms: null, platform: null, format: "unknown", problems: [] };
  const text = input.trim();
  if (!text) { out.problems.push("empty"); return out; }

  // 0. iPhone app: Apple property-list style  { CPN = xxx; videoID = "yyy"; date = "2026-11-06 20:59:16 +0000"; debugParameters = {...}; }
  if (/\bCPN\s*=\s*[A-Za-z0-9_-]{8,}\s*;/.test(text) && /\bvideoID\s*=|\bdocid\s*=/.test(text)) {
    out.format = "ios";
    out.scpn = text.match(/\bCPN\s*=\s*"?([A-Za-z0-9_-]{8,24})"?\s*;/)?.[1] ?? null;
    out.video_id = text.match(/\bvideoID\s*=\s*\\?"?([A-Za-z0-9_-]{11})\\?"?\s*;/)?.[1] ?? text.match(/docid\s*=\s*\\?"?([A-Za-z0-9_-]{11})/)?.[1] ?? null;
    const d = text.match(/\bdate\s*=\s*"([^"]+)"/)?.[1];
    if (d) { const ms = Date.parse(d.replace(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-]\d{4})$/, "$1T$2$3")); out.timestamp_ms = Number.isFinite(ms) ? ms : null; }
    out.platform = "ios";
    // No watch-time fields in this format: verify.ts measures time between two pastes of the same CPN instead.
    if (!out.scpn) out.problems.push("no_cpn"); if (!out.video_id) out.problems.push("no_video_id");
    return out;
  }

  // 1. JSON blob (possibly wrapped in other text)
  const start = text.indexOf("{"), end = text.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      const j = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
      out.format = "json";
      const s = (k: string) => (j[k] == null ? null : String(j[k]));
      const n = (k: string) => { const v = j[k]; if (v == null || v === "") return null; const x = Number(v); return Number.isFinite(x) ? x : null; };
      out.video_id = s("docid") ?? s("debug_videoId") ?? s("videoId") ?? s("video_id") ?? s("vid") ?? s("v") ?? s("videoid");
      out.scpn = s("cpn") ?? s("scpn") ?? s("client_playback_nonce") ?? s("clientPlaybackNonce");
      // Last resort: any key whose name contains "cpn"/"nonce", or any 11-char value under a key containing "video"/"doc"
      if (!out.scpn) for (const [k, v] of Object.entries(j)) if (/cpn|nonce/i.test(k) && typeof v === "string" && /^[A-Za-z0-9_-]{12,24}$/.test(v)) { out.scpn = v; break; }
      if (!out.video_id) for (const [k, v] of Object.entries(j)) if (/video|doc/i.test(k) && typeof v === "string" && /^[A-Za-z0-9_-]{11}$/.test(v)) { out.video_id = v; break; }
      out.frames_total = n("totalVideoFrames") ?? n("totalFrames") ?? n("total_frames");
      out.frames_dropped = n("droppedVideoFrames") ?? n("droppedFrames") ?? n("dropped_frames");
      out.vct = n("vct") ?? n("cmt");
      out.duration = n("vd") ?? n("len");
      out.played_seconds = sumRanges(s("vpl"));
      out.timestamp_ms = n("timestamp") ?? (s("debug_date") ? Date.parse(s("debug_date")!) || null : null) ?? (s("time") ? Date.parse(s("time")!) || null : null);
      out.platform = s("c") ?? s("cplatform");
      // fps: Android's fmt is "243 vp9 640x360@30"; desktop's fmt is a bare itag
      const fmt = s("fmt");
      const at = fmt?.match(/@(\d{2,3})/);
      if (at) out.fps = Number(at[1]);
      else { const itag = n("fmt"); if (itag != null) out.fps = FPS60.has(itag) ? 60 : 30; }
      const fpsExplicit = n("fps") ?? n("vfr");
      if (fpsExplicit) out.fps = fpsExplicit;
      // Android frames: "df":"dropped/total"
      const df = s("df")?.match(/^(\d+)\s*\/\s*(\d+)$/);
      if (df && out.frames_total == null) { out.frames_dropped = Number(df[1]); out.frames_total = Number(df[2]); }
    } catch { /* fall through to line parsing */ }
  }

  // 1b. Broken / truncated JSON: pull fields out with regexes even when JSON.parse fails
  if (out.format !== "json" && /"(docid|cpn|debug_videoId|vct|vpl|cmt|cplayer)"\s*:/.test(text)) {
    out.format = "json";
    const g = (k: string) => text.match(new RegExp(`"${k}"\\s*:\\s*"?([^",}]*)`))?.[1]?.trim() ?? null;
    const n = (k: string) => { const v = g(k); if (v == null || v === "") return null; const x = Number(v); return Number.isFinite(x) ? x : null; };
    out.video_id = g("docid") ?? g("debug_videoId") ?? g("videoId") ?? g("videoid") ?? g("video_id") ?? g("vid");
    out.scpn = g("cpn") ?? g("client_playback_nonce");
    out.frames_total = n("totalVideoFrames") ?? n("totalFrames");
    out.frames_dropped = n("droppedVideoFrames") ?? n("droppedFrames");
    const df = text.match(/"df"\s*:\s*"(\d+)\s*\\?\/\s*(\d+)"/); if (df && out.frames_total == null) { out.frames_dropped = Number(df[1]); out.frames_total = Number(df[2]); }
    out.vct = n("vct") ?? n("cmt"); out.duration = n("vd") ?? n("len");
    out.played_seconds = sumRanges(g("vpl"));
    out.timestamp_ms = n("timestamp") ?? (g("time") ? Date.parse(g("time")!) || null : null);
    const fmtAt = text.match(/"fmt"\s*:\s*"[^"]*@(\d{2,3})/); if (fmtAt) out.fps = Number(fmtAt[1]); else { const itag = n("fmt"); if (itag != null) out.fps = FPS60.has(itag) ? 60 : 30; }
    out.problems.push("truncated_json");
  }

  // 1c. key=value / key: value formats (query strings, some app builds)
  if (out.format !== "json" && /(^|[&\s])(cpn|docid|video_?id)\s*[:=]/i.test(text)) {
    out.format = "lines";
    const kv = (k: string) => text.match(new RegExp(`(?:^|[&\\s,;])${k}\\s*[:=]\\s*"?([A-Za-z0-9_\\-.:]+)`, "i"))?.[1] ?? null;
    out.video_id = kv("docid") ?? kv("video_?id") ?? kv("debug_videoId");
    out.scpn = kv("s?cpn");
    const vct = kv("vct") ?? kv("cmt"); if (vct) out.vct = Number(vct) || null;
    const vd = kv("vd") ?? kv("len"); if (vd) out.duration = Number(vd) || null;
    out.played_seconds = sumRanges(text.match(/(?:^|[&\s,;])vpl\s*[:=]\s*"?([\d.\-,]+)/i)?.[1] ?? null);
    const tf = kv("totalVideoFrames"); if (tf) out.frames_total = Number(tf) || null;
  }

  // 2. Panel lines (manual paste / mobile copy)
  if (out.format !== "json" && !(out.video_id && out.scpn)) {
    out.format = "lines";
    const m1 = text.match(/Video\s*ID\s*\/\s*s?CPN\s*:?\s*([A-Za-z0-9_-]{11})\s*\/\s*([A-Za-z0-9 _-]{12,40})/i);
    if (m1) { out.video_id = m1[1]; out.scpn = m1[2].replace(/\s+/g, ""); }
    const m2 = text.match(/(\d+)\s*dropped\s*of\s*(\d+)/i);
    if (m2) { out.frames_dropped = Number(m2[1]); out.frames_total = Number(m2[2]); }
    const m3 = text.match(/\d{3,4}\s*x\s*\d{3,4}\s*@\s*(\d{2,3})/);
    if (m3) out.fps = Number(m3[1]);
    if (!m1 && !m2 && !out.video_id) out.problems.push("unrecognized");
  }

  if (out.scpn) out.scpn = out.scpn.replace(/\s+/g, "");
  if (out.video_id && !ID.test(out.video_id)) out.problems.push("bad_video_id");
  if (out.scpn && !CPN.test(out.scpn)) out.problems.push("bad_cpn");
  if (!out.video_id) out.problems.push("no_video_id");
  if (!out.scpn) out.problems.push("no_cpn");

  // Internal consistency: played time can't exceed duration or (by much) the playhead-derived bound
  if (out.played_seconds != null && out.duration != null && out.played_seconds > out.duration + 2) out.problems.push("played_gt_duration");
  if (out.vct != null && out.duration != null && out.vct > out.duration + 2) out.problems.push("vct_gt_duration");
  return out;
}

/** "0.000-30.000,60.000-125.400" → 95.4 */
function sumRanges(v: string | null): number | null {
  if (!v) return null;
  let total = 0, any = false;
  for (const part of v.split(",")) {
    const m = part.trim().match(/^(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)$/);
    if (!m) continue;
    const a = Number(m[1]), b = Number(m[2]);
    if (b > a) { total += b - a; any = true; }
  }
  return any ? Math.round(total * 10) / 10 : null;
}

/** Best estimate of seconds actually watched from a text read. */
export function textWatchSeconds(t: TextRead): number | null {
  if (t.played_seconds != null) return t.played_seconds;
  if (t.vct != null) return t.vct;
  if (t.frames_total != null && t.fps) return t.frames_total / t.fps;
  return null;
}
