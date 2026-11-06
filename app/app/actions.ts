"use server";
import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { run, one, type Campaign, type User } from "@/lib/db";
import { parseVideoId, resolveVideo } from "@/lib/youtube";
import { overridePass, overrideFail } from "@/lib/verify";
import { sgFor, syncCampaign, sgCredsFor } from "@/lib/sproutgigs";
import { currentUser, encrypt } from "@/lib/auth";

async function me(): Promise<User> {
  const u = await currentUser();
  if (!u) redirect("/login");
  return u;
}

/** Load a campaign only if it belongs to the signed-in user. */
async function own(id: number, u: User): Promise<Campaign> {
  const c = await one<Campaign>("SELECT * FROM campaigns WHERE id = ? AND owner_id = ?", [id, u.id]);
  if (!c) throw new Error("Campaign not found");
  return c;
}

function proofModeOf(fd: FormData) {
  const m = String(fd.get("proof_mode") ?? "either");
  return ["either", "screenshot", "text", "both"].includes(m) ? m : "either";
}

function slug() {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz";
  return Array.from(randomBytes(5), (x) => alphabet[x % alphabet.length]).join("");
}

export async function createCampaign(fd: FormData) {
  const u = await me();
  const name = String(fd.get("name") ?? "").trim();
  const videoId = parseVideoId(String(fd.get("video") ?? ""));
  if (!name || !videoId) redirect("/app?e=" + encodeURIComponent("Name and a valid YouTube URL or video ID are required."));
  const minSeconds = Number(fd.get("min_seconds") ?? 0) || 0;
  const minFrames = Number(fd.get("min_frames") ?? 0) || 0;
  const keywords = String(fd.get("keywords") ?? "").split("\n").map((s) => s.trim()).filter(Boolean).join("\n");
  const instructions = String(fd.get("instructions") ?? "").trim();
  const sgJob = String(fd.get("sg_job_id") ?? "").trim() || null;
  const meta = await resolveVideo(videoId);
  const s = slug();
  await run(
    `INSERT INTO campaigns (slug, name, video_id, video_title, channel_title, channel_handle, min_frames, min_seconds, keywords, instructions, sg_job_id, proof_mode, owner_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [s, name, videoId, meta.title, meta.channelTitle, meta.channelHandle, minFrames, minSeconds, keywords, instructions, sgJob, proofModeOf(fd), u.id],
  );
  const c = await one<Campaign>("SELECT id FROM campaigns WHERE slug = ?", [s]);
  revalidatePath("/app");
  redirect(`/app/c/${c!.id}?created=1`);
}

export async function updateCampaign(fd: FormData) {
  const u = await me();
  const c = await own(Number(fd.get("id")), u);
  const keywords = String(fd.get("keywords") ?? "").split("\n").map((s) => s.trim()).filter(Boolean).join("\n");
  await run("UPDATE campaigns SET name=?, min_seconds=?, min_frames=?, keywords=?, instructions=?, sg_job_id=?, proof_mode=? WHERE id=?",
    [String(fd.get("name") ?? c.name), Number(fd.get("min_seconds") ?? 0) || 0, Number(fd.get("min_frames") ?? 0) || 0, keywords,
     String(fd.get("instructions") ?? ""), String(fd.get("sg_job_id") ?? "").trim() || null, proofModeOf(fd), c.id]);
  const v = parseVideoId(String(fd.get("video") ?? ""));
  if (v && v !== c.video_id) {
    const meta = await resolveVideo(v);
    await run("UPDATE campaigns SET video_id=?, video_title=?, channel_title=?, channel_handle=? WHERE id=?", [v, meta.title, meta.channelTitle, meta.channelHandle, c.id]);
  }
  revalidatePath(`/app/c/${c.id}`);
}

export async function setStatus(fd: FormData) {
  const u = await me();
  const c = await own(Number(fd.get("id")), u);
  const status = String(fd.get("status"));
  if (!["active", "paused", "closed"].includes(status)) return;
  await run("UPDATE campaigns SET status=? WHERE id=?", [status, c.id]);
  const creds = sgCredsFor(u);
  if (c.sg_job_id && creds) {
    try {
      const sg = sgFor(creds);
      if (status === "paused") await sg.pause(c.sg_job_id);
      else if (status === "active") await sg.resume(c.sg_job_id);
      else if (status === "closed") await sg.stop(c.sg_job_id);
    } catch (e) { console.error("SG status sync failed", e); }
  }
  revalidatePath(`/app/c/${c.id}`); revalidatePath("/app");
}

export async function override(fd: FormData) {
  const u = await me();
  const c = await own(Number(fd.get("campaign_id")), u);
  const sid = Number(fd.get("submission_id"));
  const s = await one("SELECT id FROM submissions WHERE id = ? AND campaign_id = ?", [sid, c.id]);
  if (!s) return;
  if (String(fd.get("to")) === "pass") await overridePass(sid); else await overrideFail(sid);
  revalidatePath(`/app/c/${c.id}`);
}

export async function syncNow(fd: FormData) {
  const u = await me();
  const c = await own(Number(fd.get("id")), u);
  const creds = sgCredsFor(u);
  const rep = creds ? await syncCampaign(c, creds) : { campaign: c.name, job_id: c.sg_job_id ?? "", seen: 0, ok: 0, unmatched: 0, skipped: 0, errors: ["Add your SproutGigs API credentials in Settings first."] };
  await run("INSERT INTO events (campaign_id, kind, src) VALUES (?, 'sync', ?)", [c.id, JSON.stringify(rep)]);
  revalidatePath(`/app/c/${c.id}`);
}

export async function saveSettings(fd: FormData) {
  const u = await me();
  const name = String(fd.get("name") ?? "").trim().slice(0, 80) || null;
  const sgUser = String(fd.get("sg_user_id") ?? "").trim() || null;
  const sgSecret = String(fd.get("sg_api_secret") ?? "").trim();
  await run("UPDATE users SET name = ?, sg_user_id = ? WHERE id = ?", [name, sgUser, u.id]);
  if (sgSecret) await run("UPDATE users SET sg_secret_enc = ? WHERE id = ?", [encrypt(sgSecret), u.id]);
  if (fd.get("clear_secret")) await run("UPDATE users SET sg_secret_enc = NULL, sg_user_id = NULL WHERE id = ?", [u.id]);
  revalidatePath("/app/settings");
  redirect("/app/settings?saved=1");
}

export async function testSproutGigs() {
  const u = await me();
  const creds = sgCredsFor(u);
  if (!creds) redirect("/app/settings?e=" + encodeURIComponent("Add your SproutGigs user ID and API secret first."));
  try {
    const r = await sgFor(creds!).balances();
    redirect("/app/settings?ok=" + encodeURIComponent("Connected. " + JSON.stringify(r).slice(0, 160)));
  } catch (e) {
    if ((e as Error & { digest?: string })?.digest?.startsWith("NEXT_REDIRECT")) throw e;
    redirect("/app/settings?e=" + encodeURIComponent("SproutGigs rejected the credentials: " + String((e as Error).message).slice(0, 160)));
  }
}
