import { createHash, randomBytes } from "crypto";
import { one, run, type Campaign, type Submission } from "./db";
import { readPanel, type PanelRead } from "./gemini";
import { parseDebugText, textWatchSeconds, type TextRead } from "./debugtext";

export type VerifyResult = {
  status: "pass" | "fail" | "review";
  reason: string;          // machine key
  message: string;         // worker-facing explanation
  payout_code?: string;
  details: { video_id?: string | null; scpn?: string | null; frames_total?: number | null; watch_seconds?: number | null; source?: string };
  submission_id: number;
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
  watch?: number | null; played?: number | null;
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
  if (hasText) ctx.text_sha = sha256(Buffer.from(text.replace(/\s+/g, " ")));

  // 1. Exact dedupe — bytes and text (any campaign; recycled proof is recycled everywhere)
  if (hasFiles) {
    const shas = [ctx.sha, ctx.sha2].filter((x): x is string => !!x);
    const ph = shas.map(() => "?").join(",");
    const dupe = await one<Submission>(`SELECT id FROM submissions WHERE sha256 IN (${ph}) OR sha256_2 IN (${ph}) LIMIT 1`, [...shas, ...shas]);
    if (dupe) return fail(campaign, meta, ctx, "duplicate_screenshot", "This exact screenshot was already submitted.");
  }
  if (hasText) {
    const dupe = await one<Submission>("SELECT id FROM submissions WHERE text_sha256 = ? LIMIT 1", [ctx.text_sha]);
    if (dupe) return fail(campaign, meta, ctx, "duplicate_text", "This exact debug info was already submitted.");
  }

  // 2a. Text proof (cheap, exact)
  if (hasText) {
    const t = parseDebugText(text);
    ctx.text = t;
    if (t.problems.includes("unrecognized") || t.problems.includes("no_video_id") || t.problems.includes("no_cpn"))
      return fail(campaign, meta, ctx, "text_unreadable", "The pasted text isn't YouTube debug info. In the player open ⋮ → Stats for nerds → 'Copy debug info', then paste the whole thing.");
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
  if (minSeconds > 0) {
    if (ctx.watch == null) {
      if (!(minFrames > 0 && ctx.frames_total != null)) return review(campaign, meta, ctx, "watch_time_unreadable", "We could not determine the watch time; sent for manual review.");
    } else if (ctx.watch < minSeconds) {
      return fail(campaign, meta, ctx, "insufficient_watch_time", `Only ~${Math.round(ctx.watch)}s watched (minimum ${minSeconds}s). Keep the video playing longer, then submit fresh proof.`);
    }
  }
  if (minFrames > 0) {
    if (ctx.frames_total == null) { if (minSeconds === 0 || ctx.watch == null) return review(campaign, meta, ctx, "frames_unreadable", "We could not read the frame count; sent for manual review."); }
    else if (ctx.frames_total < minFrames) return fail(campaign, meta, ctx, "insufficient_watch_time", `Only ${ctx.frames_total} frames played (minimum ${minFrames}). Keep the video playing longer, then submit fresh proof.`);
  }

  // 7. Pass → issue payout code
  const code = "pw-" + randomBytes(4).toString("hex");
  const id = await insert(campaign, meta, ctx, "pass", "verified", code);
  await run("INSERT INTO codes (code, submission_id, campaign_id) VALUES (?, ?, ?)", [code, id, campaign.id]);
  await run("INSERT INTO events (campaign_id, kind, src) VALUES (?, 'verified', ?)", [campaign.id, meta.src ?? null]);
  return { status: "pass", reason: "verified", message: "Verified. Paste this code as your proof.", payout_code: code, details: details(ctx), submission_id: id };
}

function details(ctx: Ctx) {
  return { video_id: ctx.video_id ?? null, scpn: ctx.scpn ?? null, frames_total: ctx.frames_total ?? null, watch_seconds: ctx.watch ?? null, source: ctx.source };
}

async function fail(c: Campaign, meta: Meta, ctx: Ctx, reason: string, message: string): Promise<VerifyResult> {
  const id = await insert(c, meta, ctx, "fail", reason, null);
  await run("INSERT INTO events (campaign_id, kind, src) VALUES (?, 'rejected', ?)", [c.id, meta.src ?? null]);
  return { status: "fail", reason, message, details: details(ctx), submission_id: id };
}

async function review(c: Campaign, meta: Meta, ctx: Ctx, reason: string, message: string, note?: string | null): Promise<VerifyResult> {
  const id = await insert(c, meta, ctx, "review", reason, null, note ?? undefined);
  return { status: "review", reason, message, details: details(ctx), submission_id: id };
}

async function insert(c: Campaign, meta: Meta, ctx: Ctx, status: string, reason: string, code: string | null, note?: string): Promise<number> {
  const res = await run(
    `INSERT INTO submissions (campaign_id, worker_ref, src, sha256, sha256_2, text_sha256, source, scpn, video_id_read, frames_total, frames_dropped, fps, watch_seconds, played_seconds, status, reason, payout_code, raw_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [c.id, meta.worker_ref ?? null, meta.src ?? null, ctx.sha || null, ctx.sha2, ctx.text_sha, ctx.source, ctx.scpn ?? null, ctx.video_id ?? null,
     ctx.frames_total ?? null, ctx.frames_dropped ?? null, ctx.fps ?? null, ctx.watch ?? null, ctx.played ?? null, status, reason, code,
     JSON.stringify({ read: ctx.read ?? null, text: ctx.text ?? null, note: note ?? null })],
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
