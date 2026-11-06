import { createHash, randomBytes } from "crypto";
import { one, q, run, mmss, humanDur, type Campaign, type Submission } from "./db";
import { readPanel, type PanelRead } from "./gemini";
import { parseDebugText, textWatchSeconds, type TextRead } from "./debugtext";

export type VerifyResult = {
  status: "pass" | "fail" | "review";
  reason: string;          // machine key
  message: string;         // worker-facing explanation
  payout_code?: string;
  details: { video_id?: string | null; scpn?: string | null; frames_total?: number | null; watch_seconds?: number | null; source?: string };
  checks: Check[];         // per-rule breakdown for the worker
  fix?: string;            // what to do next (fail/review only)
  submission_id: number;
};

export type Check = { key: string; label: string; state: "ok" | "fail" | "unknown"; detail?: string };

/** Per-rule breakdown shown to the worker so they know exactly what passed and what to fix. */
function buildChecks(c: Campaign, ctx: Ctx, status: string, reason: string): Check[] {
  const minS = c.min_seconds || 0, minF = c.min_frames || 0;
  const out: Check[] = [];
  const readable = !!(ctx.video_id && ctx.scpn);
  out.push({ key: "readable", label: "Proof readable", state: readable ? "ok" : "fail",
    detail: readable ? (ctx.text?.format === "ios" ? "iPhone debug info parsed" : ctx.source === "text" ? "debug info parsed" : ctx.source === "both" ? "debug info + screenshot" : "panel read from screenshot")
      : ["duplicate_screenshot", "duplicate_text"].includes(reason) ? "this exact proof was already submitted"
      : reason === "text_unreadable" ? "pasted text isn't YouTube debug info"
      : reason === "text_cut_off" ? "paste is cut off — video ID / playback ID missing"
      : reason === "text_invalid" ? "debug info is altered or incomplete"
      : reason === "panel_missing" ? "Stats for nerds panel not visible / cropped"
      : reason === "ocr_error" ? "screenshot could not be read automatically" : "no usable proof" });
  if (ctx.source === "both") out.push({ key: "consistent", label: "Screenshot and text match", state: reason === "proof_mismatch" ? "fail" : readable ? "ok" : "unknown",
    detail: reason === "proof_mismatch" ? "they come from different playbacks" : undefined });
  out.push({ key: "video", label: "Right video", state: !ctx.video_id ? "unknown" : ctx.video_id === c.video_id ? "ok" : "fail",
    detail: ctx.video_id && ctx.video_id !== c.video_id ? `proof is from ${ctx.video_id}, task is ${c.video_title ?? c.video_id}` : ctx.video_id ? c.video_title ?? c.video_id : "not readable" });
  const freshFail = ["reused_playback", "stale_proof", "duplicate_screenshot", "duplicate_text"].includes(reason);
  out.push({ key: "fresh", label: "Fresh playback session", state: freshFail ? "fail" : ctx.scpn ? "ok" : "unknown",
    detail: reason === "reused_playback" ? "this playback was already paid once" : reason === "stale_proof" ? "debug info is too old" : freshFail ? "already submitted" : ctx.scpn ? "first time seen" : undefined });
  if (ctx.source !== "text") out.push({ key: "untampered", label: "Screenshot unaltered", state: ["edited_screenshot"].includes(reason) ? "fail" : ["possible_edit", "low_confidence"].includes(reason) ? "unknown" : ctx.read?.has_stats_panel ? "ok" : "unknown",
    detail: reason === "edited_screenshot" ? "text looks pasted or edited" : reason === "possible_edit" ? "needs a human look" : undefined });
  if (minS > 0 || minF > 0) {
    const need = minS > 0 ? `${minS} s` : `${minF} frames`;
    const got = ctx.watch != null ? `${mmss(ctx.watch)}` : ctx.frames_total != null ? `${ctx.frames_total} frames` : null;
    const enough = status === "pass" || (ctx.watch != null && minS > 0 && ctx.watch >= minS) || (ctx.frames_total != null && minF > 0 && ctx.frames_total >= minF && !(minS > 0 && ctx.watch != null && ctx.watch < minS));
    const state: Check["state"] = reason === "insufficient_watch_time" ? "fail" : got == null ? "unknown" : enough ? "ok" : "unknown";
    const gotTxt = ctx.watch != null ? `${mmss(ctx.watch)} watched` : got;
    const needTxt = minS > 0 ? `needs ${mmss(minS)}` : `needs ${need}`;
    let detail = gotTxt ? `${gotTxt} · ${needTxt}` : `${needTxt} — couldn't read how long you watched`;
    if (state === "fail" && ctx.watch != null && minS > 0) { const more = Math.max(1, Math.ceil(minS - ctx.watch)); detail += ` · ${humanDur(more)} more (${more} s), then copy fresh debug info`; }
    out.push({ key: "watch", label: "Watch time", state, detail });
  }
  return out;
}

const FIX: Record<string, string> = {
  no_proof: "Paste the debug info or upload a screenshot.",
  screenshot_required: "This task needs a screenshot of the Stats for nerds panel.",
  text_required: "This task needs the 'Copy debug info' text. In the player: ⋮ → Stats for nerds → Copy debug info.",
  both_required: "This task needs both the screenshot and the debug info text from the same playback.",
  duplicate_screenshot: "Watch the video again in a fresh session and take a new screenshot. Reusing a screenshot — yours or anyone else's — is always declined.",
  duplicate_text: "Watch the video again and copy fresh debug info. Re-pasting the same text is always declined.",
  text_unreadable: "Open the video, tap ⋮ (or right-click the player) → Stats for nerds → Copy debug info, and paste the whole thing without editing.",
  second_paste_needed: "Leave the video playing. After the minimum time, open Stats for nerds again → copy → paste here. Same video, same session (don't close or reload it), and your second paste completes the check.",
  text_cut_off: "Go back to the video (keep it playing), open Stats for nerds, tap the COPY icon in the panel — don't select text by hand — then come back, long-press the box and Paste the whole text.",
  text_invalid: "Copy the debug info again without changing anything. Edited numbers are detected and declined.",
  stale_proof: "Watch the video again now and copy fresh debug info — proof must be recent.",
  panel_missing: "Open Stats for nerds and make sure the 'Video ID / sCPN' and 'Viewport / Frames' lines are fully visible before you screenshot. Or paste the 'Copy debug info' text instead.",
  proof_mismatch: "Your screenshot and text are from different playbacks. Watch once, then take both from that same session.",
  reused_playback: "This playback session was already paid. Reload the video (a new session), watch it again, then submit new proof.",
  wrong_video: "Search the keyword shown above and open the correct video — check the title and channel match before you watch.",
  edited_screenshot: "Take a clean, unedited screenshot. Altered screenshots are declined.",
  insufficient_watch_time: "Keep the video playing until you reach the minimum, then copy fresh debug info (or take a new screenshot).",
  watch_time_unreadable: "We couldn't read how long you watched. Paste the 'Copy debug info' text — it includes exact played time.",
  frames_unreadable: "The frame count wasn't visible. Paste the 'Copy debug info' text, or retake the screenshot with the 'Viewport / Frames' line visible.",
  ocr_error: "Automatic reading failed. Paste the 'Copy debug info' text for an instant result.",
  possible_edit: "This one needs a human look. You can also paste the 'Copy debug info' text for an instant decision.",
  low_confidence: "The screenshot was hard to read. Paste the 'Copy debug info' text for an instant decision.",
};

export type ProofMode = "either" | "screenshot" | "text" | "both";

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_TEXT = 20_000;
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);
const TEXT_MAX_AGE_H = Number(process.env.TEXT_MAX_AGE_HOURS ?? 24);

type Meta = { worker_ref?: string | null; src?: string | null; mock?: string | null };

// Everything we learned about one submission, from either source.
type Ctx = {
  sha: string; sha2: string | null; text_sha: string | null; source: "screenshot" | "text" | "both";
  read?: PanelRead; text?: TextRead;
  video_id?: string | null; scpn?: string | null; frames_total?: number | null; frames_dropped?: number | null; fps?: number | null;
  watch?: number | null; played?: number | null; note?: string; raw?: string; creditedFrom?: number[];
};

export async function verifySubmission(
  campaign: Campaign,
  files: { bytes: Buffer; mime: string }[],
  meta: Meta = {},
  proofText: string | null = null,
): Promise<VerifyResult> {
  const mode = ((campaign as Campaign & { proof_mode?: string }).proof_mode ?? "either") as ProofMode;
  const text = (proofText ?? "").trim().slice(0, MAX_TEXT);
  files = files.slice(0, 2);
  const hasFiles = files.length > 0, hasText = text.length > 0;

  const base: Ctx = { sha: "", sha2: null, text_sha: null, source: hasFiles && hasText ? "both" : hasText ? "text" : "screenshot" };

  // 0. Input validation against the campaign's proof mode
  if (!hasFiles && !hasText) return fail(campaign, meta, base, "no_proof", "Upload a screenshot or paste the debug info.");
  if (mode === "screenshot" && !hasFiles) return fail(campaign, meta, base, "screenshot_required", "This task requires a screenshot of the Stats for nerds panel.");
  if (mode === "text" && !hasText) return fail(campaign, meta, base, "text_required", "This task requires the copied debug info text.");
  if (mode === "both" && !(hasFiles && hasText)) return fail(campaign, meta, base, "both_required", "This task requires both the screenshot and the copied debug info.");
  for (const f of files) {
    if (f.bytes.length > MAX_BYTES) return fail(campaign, meta, base, "file_too_large", "Screenshot is larger than 8 MB.");
    if (!ALLOWED.has(f.mime)) return fail(campaign, meta, base, "bad_file_type", "Upload a PNG or JPG screenshot.");
  }

  const ctx: Ctx = { ...base };
  if (hasFiles) { ctx.sha = sha256(files[0].bytes); ctx.sha2 = files[1] ? sha256(files[1].bytes) : null; }
  if (hasText) { ctx.text_sha = sha256(Buffer.from(text.replace(/\s+/g, " "))); ctx.raw = text.slice(0, 4000); }

  // 1. Exact dedupe — bytes and text (any campaign; recycled proof is recycled everywhere)
  if (hasFiles) {
    const shas = [ctx.sha, ctx.sha2].filter((x): x is string => !!x);
    const ph = shas.map(() => "?").join(",");
    const dupe = await one<Submission>(`SELECT id FROM submissions WHERE sha256 IN (${ph}) OR sha256_2 IN (${ph}) LIMIT 1`, [...shas, ...shas]);
    if (dupe) return fail(campaign, meta, ctx, "duplicate_screenshot", "This exact screenshot was already submitted.");
  }
  if (hasText) {
    const dupe = await one<Submission>("SELECT * FROM submissions WHERE text_sha256 = ? ORDER BY id DESC LIMIT 1", [ctx.text_sha]);
    if (dupe && dupe.status === "pass") return fail(campaign, meta, ctx, "duplicate_text", "This exact debug info was already used for a payout. Watch again and copy fresh debug info.");
    if (dupe && dupe.campaign_id === campaign.id && dupe.reason !== "second_paste_needed") {
      // Same text as a previous failed attempt: nothing new to check. Repeat the verdict with concrete guidance.
      // (A pending iPhone timer is excluded: an identical re-paste must still reach the elapsed-time check below.)
      await run("UPDATE submissions SET attempts = attempts + 1, updated_at = datetime('now'), worker_ref = COALESCE(?, worker_ref) WHERE id = ?", [meta.worker_ref ?? null, dupe.id]);
      const minS = campaign.min_seconds || 0;
      let msg = "This is the same text as your last attempt, so nothing has changed.";
      if (dupe.reason === "insufficient_watch_time" && dupe.watch_seconds != null && minS > 0) {
        const more = Math.max(1, Math.ceil(minS - dupe.watch_seconds));
        msg = `Same text as your last attempt — you had watched ${mmss(dupe.watch_seconds)}, this task needs ${mmss(minS)}. Keep the video playing ${humanDur(more)} more (${more} s), then tap Copy debug info AGAIN and paste the new text.`;
      } else if (dupe.reason === "wrong_video") msg = "Same text as your last attempt — it's still from the wrong video. Open the correct video, watch it, then copy fresh debug info.";
      else msg += " Watch the video, then tap Copy debug info again — each copy is different — and paste the new text.";
      ctx.text = parseDebugText(text); ctx.video_id = ctx.text.video_id; ctx.scpn = ctx.text.scpn; ctx.watch = dupe.watch_seconds; ctx.frames_total = dupe.frames_total;
      return { status: "fail", reason: dupe.reason, message: msg, details: details(ctx), checks: buildChecks(campaign, ctx, "fail", dupe.reason), fix: FIX[dupe.reason] ?? FIX.insufficient_watch_time, submission_id: dupe.id };
    }
    if (dupe) return fail(campaign, meta, ctx, "duplicate_text", "This exact debug info was already submitted to another task.");
  }

  // 2a. Text proof (cheap, exact)
  if (hasText) {
    const t = parseDebugText(text);
    ctx.text = t;
    if (t.problems.includes("unrecognized") || t.problems.includes("no_video_id") || t.problems.includes("no_cpn")) {
      const flat = text.replace(/\s+/g, " ");
      // Record the key names when it is JSON, so an unknown schema (e.g. a new app version) is visible without storing every value.
      let keys = "";
      try { const a = text.indexOf("{"), b = text.lastIndexOf("}"); if (a !== -1 && b > a) keys = " keys=[" + Object.keys(JSON.parse(text.slice(a, b + 1))).join(",") + "]"; } catch { keys = " keys=[" + Array.from(text.matchAll(/"([A-Za-z0-9_]+)"\s*:/g)).map((m) => m[1]).join(",") + "]"; }
      ctx.note = `unreadable sample (${text.length} chars)${keys}: ${flat.slice(0, 600)}${flat.length > 800 ? " … " + flat.slice(-200) : flat.length > 600 ? " … " + flat.slice(600) : ""}`;
      const looksYt = /"(cplayer|cplatform|cver|cbr|cos|fexp|el)"\s*:/.test(text) || /PLATYPUS|UNIPLAYER|com\.google\.android\.youtube/.test(text);
      const android = /"c"\s*:\s*"android"|com\.google\.android\.youtube|PLATYPUS/i.test(text);
      const cutStart = looksYt && !/^\s*\{/.test(text);   // desktop starts {"ns":"yt", Android starts {"cplatform": — both begin with "{"
      if (looksYt) {
        return fail(campaign, meta, ctx, "text_cut_off",
          (cutStart ? "Your paste is cut off — it starts in the middle of the debug info, so the video ID and playback ID are missing. " : "Your paste is incomplete — the video ID and playback ID are missing. ")
          + (android
            ? "On Android: in the Stats for nerds panel tap the small COPY icon (top-right of the panel) — don't select the text by hand — then long-press this box → Paste the whole thing."
            : "Use the 'Copy debug info' button in the Stats for nerds panel (don't select the text by hand), then paste the whole thing."));
      }
      return fail(campaign, meta, ctx, "text_unreadable", "The pasted text isn't YouTube debug info. Open ⋮ → Stats for nerds → tap the copy icon / 'Copy debug info', then paste ALL of it (it starts with { and is usually 1,000–2,000 characters).");
    }
    if (t.problems.includes("bad_video_id") || t.problems.includes("bad_cpn") || t.problems.includes("played_gt_duration") || t.problems.includes("vct_gt_duration"))
      return fail(campaign, meta, ctx, "text_invalid", "The debug info looks altered or incomplete. Copy it again without editing.");
    if (t.timestamp_ms && TEXT_MAX_AGE_H > 0 && Date.now() - t.timestamp_ms > TEXT_MAX_AGE_H * 3600_000)
      return fail(campaign, meta, ctx, "stale_proof", `This debug info is older than ${TEXT_MAX_AGE_H} hours. Watch the video again and copy fresh debug info.`);
    ctx.video_id = t.video_id; ctx.scpn = t.scpn; ctx.frames_total = t.frames_total; ctx.frames_dropped = t.frames_dropped; ctx.fps = t.fps;
    ctx.played = t.played_seconds; ctx.watch = textWatchSeconds(t);
  }

  // 2b. Screenshot proof (vision read)
  if (hasFiles) {
    let read: PanelRead | null = null, ocrErr: string | null = null;
    try { read = await readPanel(files, meta.mock); } catch (e) { ocrErr = String(e); }
    if (!read && !hasText)
      return review(campaign, meta, ctx, "ocr_error", "We couldn't read the screenshot automatically; it has been sent for manual review.", ocrErr);
    // If the vision read failed but text is present, the text carries the decision.
    const r = read ?? { has_stats_panel: false, video_id: null, scpn: null, frames_dropped: null, frames_total: null, fps: null, current_res: null,
      channel_name: null, video_title: null, platform: "unknown" as const, looks_edited: false, edit_notes: ocrErr, confidence: 0 };
    ctx.read = r;
    if (!hasText) {
      if (!r.has_stats_panel || !r.video_id || !r.scpn)
        return fail(campaign, meta, ctx, "panel_missing", "The 'Stats for nerds' panel isn't visible or is cropped. Make sure the 'Video ID / sCPN' and 'Viewport / Frames' lines are fully visible, then retake the screenshot — or paste the 'Copy debug info' text instead.");
      ctx.video_id = r.video_id; ctx.scpn = r.scpn; ctx.frames_total = r.frames_total; ctx.frames_dropped = r.frames_dropped; ctx.fps = r.fps;
      ctx.watch = r.frames_total != null && r.fps ? r.frames_total / r.fps : null;
    } else if (r.has_stats_panel && r.video_id && r.scpn) {
      // 2c. Both present → they must describe the same playback
      if (r.video_id !== ctx.video_id || r.scpn !== ctx.scpn)
        return fail(campaign, meta, ctx, "proof_mismatch", "The screenshot and the debug info are from different playbacks. Submit both from the same viewing session.");
      ctx.frames_total = ctx.frames_total ?? r.frames_total; ctx.frames_dropped = ctx.frames_dropped ?? r.frames_dropped; ctx.fps = ctx.fps ?? r.fps;
      if (ctx.watch == null && r.frames_total != null && r.fps) ctx.watch = r.frames_total / r.fps;
    }
    if (r.looks_edited && r.confidence >= 0.6) return fail(campaign, meta, ctx, "edited_screenshot", "This screenshot appears to have been altered.");
  }

  // 3. Playback-nonce dedupe (survives crop/resize/recompress and re-copies)
  const nonce = await one<Submission>("SELECT id FROM submissions WHERE scpn = ? AND status = 'pass' LIMIT 1", [ctx.scpn!]);
  if (nonce) return fail(campaign, meta, ctx, "reused_playback", "This playback session was already used for a payout. Watch the video again in a fresh session and submit new proof.");

  // 4. Right video
  if (ctx.video_id !== campaign.video_id)
    return fail(campaign, meta, ctx, "wrong_video", `Your proof is from video ${ctx.video_id}, but this task is for a different video. Search the keyword and open the correct one.`);

  // 5. Screenshot-only soft signals
  if (ctx.read && !hasText) {
    if (ctx.read.looks_edited) return review(campaign, meta, ctx, "possible_edit", "This screenshot needs a manual look before approval.", ctx.read.edit_notes);
    if (ctx.read.confidence < 0.4) return review(campaign, meta, ctx, "low_confidence", "Low-confidence read; sent for manual review.");
  }

  // 6. Watch time
  const minFrames = campaign.min_frames || 0, minSeconds = campaign.min_seconds || 0;
  // 6a. Text proof without watch-time fields (iPhone app): measure the gap between two pastes of the SAME playback,
  //     on the server clock. First paste opens the timer; a later paste with the same CPN closes it.
  if (minSeconds > 0 && ctx.watch == null && hasText && ctx.text && ctx.scpn) {
    const first = await one<{ id: number; created_at: string; attempts: number }>("SELECT id, created_at, attempts FROM submissions WHERE campaign_id = ? AND scpn = ? AND status != 'pass' ORDER BY id ASC LIMIT 1", [campaign.id, ctx.scpn]);
    if (!first) {
      ctx.note = "timer started (text has no watch-time fields)";
      return fail(campaign, meta, ctx, "second_paste_needed",
        `${ctx.text.format === "ios" ? "iPhone's" : "This"} debug info doesn't include watch time, so we time it between two pastes. Timer started now. Keep this video playing — don't close or reload it — and after ${mmss(minSeconds)} open Stats for nerds again, copy, and paste the new text here.`);
    }
    const elapsed = (Date.now() - Date.parse(first.created_at.replace(" ", "T") + "Z")) / 1000;
    if (elapsed < minSeconds) {
      const more = Math.max(1, Math.ceil(minSeconds - elapsed));
      ctx.watch = elapsed;
      return fail(campaign, meta, ctx, "insufficient_watch_time",
        `Your first paste was ${mmss(elapsed)} ago — this task needs ${mmss(minSeconds)}. Keep the video playing ${humanDur(more)} more (${more} s), then copy and paste the debug info again (same video, don't reload).`);
    }
    ctx.watch = elapsed; ctx.played = elapsed;
  }
  if (minSeconds > 0) {
    if (ctx.watch == null) {
      if (!(minFrames > 0 && ctx.frames_total != null)) return review(campaign, meta, ctx, "watch_time_unreadable", "We could not determine the watch time; sent for manual review.");
    } else if (ctx.watch < minSeconds) {
      // Cumulative credit: earlier short sessions by the SAME worker on this campaign (distinct playback IDs,
      // never paid, never credited before) count toward the total. A restarted video no longer wipes out their time.
      let credit = 0; let creditRows: { id: number; watch_seconds: number; scpn: string }[] = [];
      if ((campaign.cumulative_watch ?? 1) !== 0 && meta.worker_ref) {
        creditRows = await q<{ id: number; watch_seconds: number; scpn: string }>(
          `SELECT id, watch_seconds, scpn FROM submissions WHERE campaign_id = ? AND worker_ref = ? AND status = 'fail' AND reason = 'insufficient_watch_time'
             AND watch_seconds IS NOT NULL AND scpn IS NOT NULL AND scpn != ? AND credited_to IS NULL AND created_at > datetime('now', '-3 days') ORDER BY id`,
          [campaign.id, meta.worker_ref, ctx.scpn ?? ""]);
        credit = creditRows.reduce((a, r) => a + Number(r.watch_seconds), 0);
      }
      const total = ctx.watch + credit;
      if (total < minSeconds) {
        const more = Math.max(1, Math.ceil(minSeconds - total));
        const breakdown = credit > 0 ? `This session ${mmss(ctx.watch)} + ${mmss(credit)} from your earlier session${creditRows.length > 1 ? "s" : ""} = ${mmss(total)} total.` : `You watched ${mmss(ctx.watch)}.`;
        return fail(campaign, meta, ctx, "insufficient_watch_time",
          `${breakdown} This task needs ${mmss(minSeconds)}. Keep THIS video playing ${humanDur(more)} more (${more} s) — don't restart or reload it — then copy fresh debug info and paste it here.${credit === 0 ? " (If you do restart by accident, your time so far still counts toward your total.)" : ""}`);
      }
      // Enough with credit → pass. Mark the credited sessions so they can't be counted twice.
      ctx.note = `credited ${mmss(credit)} from earlier session${creditRows.length > 1 ? "s" : ""} #${creditRows.map((r) => r.id).join(", #")}`;
      ctx.creditedFrom = creditRows.map((r) => r.id);
      ctx.watch = total;
    }
  }
  if (minFrames > 0) {
    if (ctx.frames_total == null) { if (minSeconds === 0 || ctx.watch == null) return review(campaign, meta, ctx, "frames_unreadable", "We could not read the frame count; sent for manual review."); }
    else if (ctx.frames_total < minFrames) return fail(campaign, meta, ctx, "insufficient_watch_time", `Only ${ctx.frames_total} frames played (minimum ${minFrames}). Keep the video playing longer, then submit fresh proof.`);
  }

  // 7. Pass → issue payout code
  const code = "pw-" + randomBytes(4).toString("hex");
  const id = await insert(campaign, meta, ctx, "pass", "verified", code, ctx.note);
  if (ctx.creditedFrom?.length) await run(`UPDATE submissions SET credited_to = ? WHERE id IN (${ctx.creditedFrom.map(() => "?").join(",")})`, [id, ...ctx.creditedFrom]);
  await run("INSERT INTO codes (code, submission_id, campaign_id) VALUES (?, ?, ?)", [code, id, campaign.id]);
  await run("INSERT INTO events (campaign_id, kind, src) VALUES (?, 'verified', ?)", [campaign.id, meta.src ?? null]);
  return { status: "pass", reason: "verified", message: ctx.creditedFrom?.length ? `Verified — ${mmss(ctx.watch ?? 0)} in total, counting your earlier session${ctx.creditedFrom.length > 1 ? "s" : ""}. Paste this code as your proof.` : "Verified. Paste this code as your proof.", payout_code: code, details: details(ctx), checks: buildChecks(campaign, ctx, "pass", "verified"), submission_id: id };
}

function details(ctx: Ctx) {
  return { video_id: ctx.video_id ?? null, scpn: ctx.scpn ?? null, frames_total: ctx.frames_total ?? null, watch_seconds: ctx.watch ?? null, source: ctx.source };
}

async function fail(c: Campaign, meta: Meta, ctx: Ctx, reason: string, message: string): Promise<VerifyResult> {
  const id = await insert(c, meta, ctx, "fail", reason, null, ctx.note);
  await run("INSERT INTO events (campaign_id, kind, src) VALUES (?, 'rejected', ?)", [c.id, meta.src ?? null]);
  return { status: "fail", reason, message, details: details(ctx), checks: buildChecks(c, ctx, "fail", reason), fix: FIX[reason], submission_id: id };
}

async function review(c: Campaign, meta: Meta, ctx: Ctx, reason: string, message: string, note?: string | null): Promise<VerifyResult> {
  const id = await insert(c, meta, ctx, "review", reason, null, note ?? undefined);
  return { status: "review", reason, message, details: details(ctx), checks: buildChecks(c, ctx, "review", reason), fix: FIX[reason], submission_id: id };
}

async function insert(c: Campaign, meta: Meta, ctx: Ctx, status: string, reason: string, code: string | null, note?: string): Promise<number> {
  // Keep one row per playback attempt: a worker who watches more and re-copies the debug info (same cpn)
  // updates their earlier failed row instead of stacking new ones. Rows with a payout code are never touched.
  let prior: { id: number } | null = null;
  if (ctx.scpn) prior = await one<{ id: number }>("SELECT id FROM submissions WHERE campaign_id = ? AND scpn = ? AND status != 'pass' ORDER BY id DESC LIMIT 1", [c.id, ctx.scpn]);
  else if (meta.worker_ref) prior = await one<{ id: number }>("SELECT id FROM submissions WHERE campaign_id = ? AND worker_ref = ? AND scpn IS NULL AND status != 'pass' AND created_at > datetime('now', '-6 hours') ORDER BY id DESC LIMIT 1", [c.id, meta.worker_ref]);
  if (prior) {
    await run(
      `UPDATE submissions SET worker_ref = COALESCE(?, worker_ref), src = COALESCE(?, src), sha256 = ?, sha256_2 = ?, text_sha256 = ?, source = ?, scpn = ?, video_id_read = ?,
         frames_total = ?, frames_dropped = ?, fps = ?, watch_seconds = ?, played_seconds = ?, status = ?, reason = ?, payout_code = ?, raw_json = ?,
         attempts = attempts + 1, updated_at = datetime('now') WHERE id = ?`,
      [meta.worker_ref ?? null, meta.src ?? null, ctx.sha || null, ctx.sha2, ctx.text_sha, ctx.source, ctx.scpn ?? null, ctx.video_id ?? null,
       ctx.frames_total ?? null, ctx.frames_dropped ?? null, ctx.fps ?? null, ctx.watch ?? null, ctx.played ?? null, status, reason, code,
       JSON.stringify({ read: ctx.read ?? null, text: ctx.text ?? null, raw: ctx.raw ?? null, note: note ?? null }), prior.id]);
    return prior.id;
  }
  const res = await run(
    `INSERT INTO submissions (campaign_id, worker_ref, src, sha256, sha256_2, text_sha256, source, scpn, video_id_read, frames_total, frames_dropped, fps, watch_seconds, played_seconds, status, reason, payout_code, raw_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [c.id, meta.worker_ref ?? null, meta.src ?? null, ctx.sha || null, ctx.sha2, ctx.text_sha, ctx.source, ctx.scpn ?? null, ctx.video_id ?? null,
     ctx.frames_total ?? null, ctx.frames_dropped ?? null, ctx.fps ?? null, ctx.watch ?? null, ctx.played ?? null, status, reason, code,
     JSON.stringify({ read: ctx.read ?? null, text: ctx.text ?? null, raw: ctx.raw ?? null, note: note ?? null })],
  );
  return Number(res.lastInsertRowid);
}

function sha256(b: Buffer) { return createHash("sha256").update(b).digest("hex"); }

/** Admin override: force a submission to pass and mint a code if it has none. */
export async function overridePass(submissionId: number): Promise<string> {
  const s = await one<Submission>("SELECT * FROM submissions WHERE id = ?", [submissionId]);
  if (!s) throw new Error("not found");
  if (s.payout_code) return s.payout_code;
  const code = "pw-" + randomBytes(4).toString("hex");
  await run("UPDATE submissions SET status='pass', reason='manual_override', payout_code=? WHERE id=?", [code, submissionId]);
  await run("INSERT INTO codes (code, submission_id, campaign_id) VALUES (?, ?, ?)", [code, submissionId, s.campaign_id]);
  return code;
}

export async function overrideFail(submissionId: number) {
  await run("UPDATE submissions SET status='fail', reason='manual_reject' WHERE id=?", [submissionId]);
}
