"use server";
import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { run, one, type Campaign } from "@/lib/db";
import { parseVideoId, resolveVideo } from "@/lib/youtube";
import { overridePass, overrideFail } from "@/lib/verify";
import { sg, syncCampaign } from "@/lib/sproutgigs";

function proofModeOf(fd: FormData) {
  const m = String(fd.get("proof_mode") ?? "either");
  return ["either", "screenshot", "text", "both"].includes(m) ? m : "either";
}

function slug() {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz";
  const b = randomBytes(5);
  return Array.from(b, (x) => alphabet[x % alphabet.length]).join("");
}

export async function createCampaign(fd: FormData) {
  const name = String(fd.get("name") ?? "").trim();
  const videoId = parseVideoId(String(fd.get("video") ?? ""));
  if (!name || !videoId) throw new Error("Name and a valid YouTube URL/ID are required");
  const minSeconds = Number(fd.get("min_seconds") ?? 0) || 0;
  const minFrames = Number(fd.get("min_frames") ?? 0) || 0;
  const keywords = String(fd.get("keywords") ?? "").split("\n").map((s) => s.trim()).filter(Boolean).join("\n");
  const instructions = String(fd.get("instructions") ?? "").trim();
  const sgJob = String(fd.get("sg_job_id") ?? "").trim() || null;
  const proofMode = proofModeOf(fd);
  const meta = await resolveVideo(videoId);
  const s = slug();
  await run(
    `INSERT INTO campaigns (slug, name, video_id, video_title, channel_title, channel_handle, min_frames, min_seconds, keywords, instructions, sg_job_id, proof_mode)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [s, name, videoId, meta.title, meta.channelTitle, meta.channelHandle, minFrames, minSeconds, keywords, instructions, sgJob, proofMode],
  );
  const c = await one<Campaign>("SELECT id FROM campaigns WHERE slug = ?", [s]);
  revalidatePath("/admin");
  redirect(`/admin/c/${c!.id}`);
}

export async function updateCampaign(fd: FormData) {
  const id = Number(fd.get("id"));
  const keywords = String(fd.get("keywords") ?? "").split("\n").map((s) => s.trim()).filter(Boolean).join("\n");
  await run("UPDATE campaigns SET name=?, min_seconds=?, min_frames=?, keywords=?, instructions=?, sg_job_id=?, proof_mode=? WHERE id=?",
    [String(fd.get("name") ?? ""), Number(fd.get("min_seconds") ?? 0) || 0, Number(fd.get("min_frames") ?? 0) || 0, keywords,
     String(fd.get("instructions") ?? ""), String(fd.get("sg_job_id") ?? "").trim() || null, proofModeOf(fd), id]);
  const v = parseVideoId(String(fd.get("video") ?? ""));
  if (v) {
    const meta = await resolveVideo(v);
    await run("UPDATE campaigns SET video_id=?, video_title=?, channel_title=?, channel_handle=? WHERE id=?", [v, meta.title, meta.channelTitle, meta.channelHandle, id]);
  }
  revalidatePath(`/admin/c/${id}`);
}

export async function setStatus(fd: FormData) {
  const id = Number(fd.get("id")), status = String(fd.get("status"));
  const c = await one<Campaign>("SELECT * FROM campaigns WHERE id = ?", [id]);
  await run("UPDATE campaigns SET status=? WHERE id=?", [status, id]);
  // Mirror to SproutGigs if linked and creds exist (best effort).
  if (c?.sg_job_id && process.env.SG_API_SECRET) {
    try {
      if (status === "paused") await sg.pause(c.sg_job_id);
      else if (status === "active") await sg.resume(c.sg_job_id);
      else if (status === "closed") await sg.stop(c.sg_job_id);
    } catch (e) { console.error("SG status sync failed", e); }
  }
  revalidatePath(`/admin/c/${id}`); revalidatePath("/admin");
}

export async function override(fd: FormData) {
  const sid = Number(fd.get("submission_id")), cid = Number(fd.get("campaign_id"));
  if (String(fd.get("to")) === "pass") await overridePass(sid); else await overrideFail(sid);
  revalidatePath(`/admin/c/${cid}`);
}

export async function syncNow(fd: FormData) {
  const id = Number(fd.get("id"));
  const c = await one<Campaign>("SELECT * FROM campaigns WHERE id = ?", [id]);
  if (c) {
    const rep = await syncCampaign(c);
    await run("INSERT INTO events (campaign_id, kind, src) VALUES (?, 'sync', ?)", [id, JSON.stringify(rep)]);
  }
  revalidatePath(`/admin/c/${id}`);
}
