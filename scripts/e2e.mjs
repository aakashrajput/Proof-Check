// End-to-end smoke test against a running dev/prod server with GEMINI_MOCK_JSON set.
// Usage: BASE_URL=http://localhost:3000 ADMIN_PASSWORD=x node scripts/e2e.mjs
import { createClient } from "@libsql/client";
import { randomBytes } from "crypto";

const base = process.env.BASE_URL || "http://localhost:3000";
const pw = process.env.ADMIN_PASSWORD || "x";
const db = createClient({ url: process.env.DATABASE_URL || "file:./data/proofcheck.db" });
const VIDEO = "dQw4w9WgXcQ";
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? "  ✓ " : "  ✗ ") + msg); if (!cond) fails++; };

// warm the server so it creates the schema
await fetch(`${base}/t/__warm__`).catch(() => {});

// login
const login = await fetch(`${base}/api/admin/login`, { method: "POST", body: new URLSearchParams({ password: pw, next: "/admin" }), redirect: "manual" });
const cookie = login.headers.get("set-cookie")?.split(";")[0];
ok(login.status === 303 && cookie?.startsWith("pc_admin="), "admin login sets cookie");
const noauth = await fetch(`${base}/admin`, { redirect: "manual" });
ok(noauth.status === 307 || noauth.status === 302, "admin redirects when logged out");

// create campaign directly in DB (server action needs RSC plumbing; API path is what workers hit)
const slug = "T" + randomBytes(3).toString("hex");
await db.execute({ sql: "INSERT INTO campaigns (slug,name,video_id,min_seconds,keywords) VALUES (?,?,?,?,?)", args: [slug, "e2e", VIDEO, 120, "kw one\nkw two"] });
const cid = Number((await db.execute({ sql: "SELECT id FROM campaigns WHERE slug=?", args: [slug] })).rows[0].id);

const page = await fetch(`${base}/t/${slug}?src=sg`).then((r) => r.text());
ok(page.includes("kw one") || page.includes("kw two"), "worker page renders a keyword");
const page2 = await fetch(`${base}/t/${slug}`).then((r) => r.text());
ok((page.includes("kw one")) !== (page2.includes("kw one")), "keyword rotates between visits");

async function submit(bytes, mockOverride, text) {
  // The server reads GEMINI_MOCK_JSON from env; we vary the *image bytes* and rely on a per-request header hook below.
  const fd = new FormData();
  fd.set("slug", slug); fd.set("src", "sg"); fd.set("worker_ref", "tester");
  if (text) fd.set("text", text);
  if (bytes) fd.append("file", new Blob([bytes], { type: "image/png" }), "s.png");
  const r = await fetch(`${base}/api/verify`, { method: "POST", body: fd, headers: mockOverride ? { "x-mock-read": JSON.stringify(mockOverride) } : {} });
  return r.json();
}
const png = (tag) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.from(tag)]);
const good = { has_stats_panel: true, video_id: VIDEO, scpn: "AAAA BBBB CCCC DDDD", frames_dropped: 3, frames_total: 4500, fps: 30, platform: "android", looks_edited: false, confidence: 0.95 };

let r = await submit(png("a"), good);
ok(r.status === "pass" && /^pw-[a-f0-9]{8}$/.test(r.payout_code), `clean screenshot passes, code ${r.payout_code}`);
const code = r.payout_code;
r = await submit(png("a"), good);
ok(r.reason === "duplicate_screenshot", "same bytes rejected as duplicate");
r = await submit(png("b"), { ...good });
ok(r.reason === "reused_playback", "same sCPN with new bytes rejected as reused playback");
r = await submit(png("c"), { ...good, scpn: "NEWNONCE1", video_id: "xxxxxxxxxxx" });
ok(r.reason === "wrong_video", "wrong video id rejected");
r = await submit(png("d"), { ...good, scpn: "NEWNONCE2", frames_total: 900 });
ok(r.reason === "insufficient_watch_time", "900 frames @30fps = 30s < 120s rejected");
r = await submit(png("e"), { ...good, scpn: "NEWNONCE3", has_stats_panel: false, video_id: null, scpn: null });
ok(r.reason === "panel_missing", "no panel rejected");
r = await submit(png("f"), { ...good, scpn: "NEWNONCE4", looks_edited: true, confidence: 0.9 });
ok(r.reason === "edited_screenshot", "edited screenshot rejected");
r = await submit(png("g"), { ...good, scpn: "NEWNONCE5", frames_total: null });
ok(r.status === "review", `unreadable frames -> review (${r.reason})`);
r = await submit(png("h"), { ...good, scpn: "NEWNONCE6" });
ok(r.status === "pass", "second clean session passes");

// ---- text proof path ----
const dbg = (o = {}) => JSON.stringify({ ns: "yt", el: "detailpage", cpn: "Qm7xP2kLa9Rt3VbN", ver: 2, fmt: "247", c: "WEB", cplatform: "DESKTOP", docid: VIDEO,
  vct: "150.400", vd: "212.101", vpl: "0.000-150.400", vbu: "0.000-180.000", totalVideoFrames: 4512, droppedVideoFrames: 3,
  debug_videoId: VIDEO, debug_date: new Date().toString(), timestamp: Date.now(), ...o });
const firstText = dbg();
r = await submit(null, null, firstText);
ok(r.status === "pass" && r.details.source === "text" && Math.round(r.details.watch_seconds) === 150, `text-only debug info passes (150s via vpl), code ${r.payout_code}`);
r = await submit(null, null, firstText);
ok(r.reason === "duplicate_text", "same text rejected as duplicate");
r = await submit(null, null, dbg({ timestamp: Date.now() + 1 }));
ok(r.reason === "reused_playback", "re-copied text with same cpn rejected as reused playback");
r = await submit(null, null, dbg({ cpn: "Aa1Bb2Cc3Dd4Ee5F", vct: "200.000", vpl: "0.000-30.000,170.000-200.000" }));
ok(r.reason === "insufficient_watch_time" && /~60s/.test(r.message), "skipped-through video: vpl sums to 60s < 120s even though playhead is 200s");
r = await submit(null, null, dbg({ cpn: "Bb1Bb2Cc3Dd4Ee5F", docid: "xxxxxxxxxxx", debug_videoId: "xxxxxxxxxxx" }));
ok(r.reason === "wrong_video", "text with wrong docid rejected");
r = await submit(null, null, dbg({ cpn: "Cc1Bb2Cc3Dd4Ee5F", timestamp: Date.now() - 48 * 3600e3, debug_date: undefined }));
ok(r.reason === "stale_proof", "48h-old debug info rejected as stale");
r = await submit(null, null, dbg({ cpn: "Dd1Bb2Cc3Dd4Ee5F", vpl: "0.000-500.000" }));
ok(r.reason === "text_invalid", "played > duration rejected as tampered");
r = await submit(null, null, "hello i watched the video pls approve");
ok(r.reason === "text_unreadable", "free text rejected as unreadable");
r = await submit(null, null, `Video ID / sCPN  ${VIDEO} / EE1B B2CC 3DD4 EE5F\nViewport / Frames  1280x720*2.00 / 2 dropped of 4200\nCurrent / Optimal Res  1280x720@30 / 1280x720@30`);
ok(r.status === "pass" && Math.round(r.details.watch_seconds) === 140, "pasted panel lines parse (4200 frames @30 = 140s)");
r = await submit(png("m1"), { ...good, scpn: "Ff1Bb2Cc3Dd4Ee5F" }, dbg({ cpn: "Gg1Bb2Cc3Dd4Ee5F" }));
ok(r.reason === "proof_mismatch", `screenshot + text from different playbacks rejected (${r.reason})`);
r = await submit(png("m2"), { ...good, scpn: "Hh1Bb2Cc3Dd4Ee5F" }, dbg({ cpn: "Hh1Bb2Cc3Dd4Ee5F" }));
ok(r.status === "pass" && r.details?.source === "both", `screenshot + matching text passes as both (${r.status}/${r.reason}/${r.details?.source})`);
// proof_mode enforcement
await db.execute({ sql: "UPDATE campaigns SET proof_mode='text' WHERE id=?", args: [cid] });
r = await submit(png("m3"), { ...good, scpn: "Ii1Bb2Cc3Dd4Ee5F" });
ok(r.reason === "text_required", "proof_mode=text rejects screenshot-only");
await db.execute({ sql: "UPDATE campaigns SET proof_mode='both' WHERE id=?", args: [cid] });
r = await submit(null, null, dbg({ cpn: "Jj1Bb2Cc3Dd4Ee5F" }));
ok(r.reason === "both_required", "proof_mode=both rejects text-only");
await db.execute({ sql: "UPDATE campaigns SET proof_mode='either' WHERE id=?", args: [cid] });

// codes table + sync endpoint auth
const c = (await db.execute({ sql: "SELECT * FROM codes WHERE code=?", args: [code] })).rows[0];
ok(c && c.used_at == null && Number(c.campaign_id) === cid, "payout code stored, unused");
const s401 = await fetch(`${base}/api/sproutgigs/sync`);
ok(s401.status === 401, "sync endpoint rejects anonymous");
const s200 = await fetch(`${base}/api/sproutgigs/sync`, { headers: { authorization: `Bearer ${process.env.CRON_SECRET || "cron"}` } }).then((r) => r.json());
ok(s200.ok === true && Array.isArray(s200.reports), "sync endpoint accepts CRON_SECRET (no linked jobs → empty reports)");

const subs = await db.execute({ sql: "SELECT status, COUNT(*) n FROM submissions WHERE campaign_id=? GROUP BY status", args: [cid] });
console.log("  submissions:", subs.rows.map((x) => `${x.status}=${x.n}`).join(" "));
await db.execute({ sql: "DELETE FROM submissions WHERE campaign_id=?", args: [cid] });
await db.execute({ sql: "DELETE FROM codes WHERE campaign_id=?", args: [cid] });
await db.execute({ sql: "DELETE FROM events WHERE campaign_id=?", args: [cid] });
await db.execute({ sql: "DELETE FROM campaigns WHERE id=?", args: [cid] });
console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
process.exit(fails ? 1 : 0);
