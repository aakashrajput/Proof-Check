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

// landing + accounts
const home = await fetch(`${base}/`).then((r) => r.text());
ok(home.includes("Stop paying for views") && home.includes("/register"), "landing page renders with register CTA");
const noauth = await fetch(`${base}/app`, { redirect: "manual" });
ok((noauth.status === 307 || noauth.status === 302) && /\/login/.test(noauth.headers.get("location") ?? ""), "/app redirects to /login when signed out");
const legacy = await fetch(`${base}/admin`, { redirect: "manual" });
ok(/\/app/.test(legacy.headers.get("location") ?? ""), "/admin redirects to /app");
const email = `e2e-${randomBytes(3).toString("hex")}@example.com`;
let r0 = await fetch(`${base}/api/auth/register`, { method: "POST", body: new URLSearchParams({ email, password: "short" }), redirect: "manual" });
ok(/e=/.test(r0.headers.get("location") ?? ""), "register rejects short password");
r0 = await fetch(`${base}/api/auth/register`, { method: "POST", body: new URLSearchParams({ email, password: "correct horse battery", name: "E2E" }), redirect: "manual" });
const cookie = r0.headers.get("set-cookie")?.split(";")[0];
ok(r0.status === 303 && cookie?.startsWith("pc_session=") && /\/app/.test(r0.headers.get("location") ?? ""), "register creates account, sets session, lands on /app");
r0 = await fetch(`${base}/api/auth/register`, { method: "POST", body: new URLSearchParams({ email, password: "correct horse battery" }), redirect: "manual" });
ok(/already%20exists|already\+exists/i.test(r0.headers.get("location") ?? ""), "duplicate email rejected");
r0 = await fetch(`${base}/api/auth/login`, { method: "POST", body: new URLSearchParams({ email, password: "wrong" }), redirect: "manual" });
ok(/Wrong/.test(decodeURIComponent(r0.headers.get("location") ?? "")), "login rejects wrong password");
r0 = await fetch(`${base}/api/auth/login`, { method: "POST", body: new URLSearchParams({ email, password: "correct horse battery", next: "/app/settings" }), redirect: "manual" });
ok(r0.status === 303 && /\/app\/settings$/.test(r0.headers.get("location") ?? ""), "login honours next=");
const dash = await fetch(`${base}/app`, { headers: { cookie } }).then((r) => r.text());
ok(dash.includes("Your campaigns") && dash.includes(email), "dashboard renders for signed-in user");
const forged = `${cookie.split("=")[1].split(".")[0]}.9999999999.forgedsig`;
const f = await fetch(`${base}/app`, { headers: { cookie: `pc_session=${forged}` }, redirect: "manual" });
ok(f.status === 307 || f.status === 302, "forged session cookie is rejected");
const uid = Number((await db.execute({ sql: "SELECT id FROM users WHERE email=?", args: [email] })).rows[0].id);
// stale-but-valid session (user row gone): must end on /login with the cookie cleared, never loop
{
  const ghost = `ghost-${randomBytes(3).toString("hex")}@example.com`;
  const g = await fetch(`${base}/api/auth/register`, { method: "POST", body: new URLSearchParams({ email: ghost, password: "correct horse battery" }), redirect: "manual" });
  const gcookie = g.headers.get("set-cookie").split(";")[0];
  await db.execute({ sql: "DELETE FROM users WHERE email=?", args: [ghost] });
  let url = `${base}/app`, hops = 0, cleared = false, final = "";
  while (hops < 6) {
    const r = await fetch(url, { headers: { cookie: gcookie }, redirect: "manual" });
    const sc = r.headers.get("set-cookie") ?? "";
    if (/pc_session=;|Max-Age=0/i.test(sc)) cleared = true;
    const loc = r.headers.get("location");
    if (!loc) { final = url; break; }
    url = new URL(loc, base).toString(); hops++;
  }
  ok(hops < 6 && cleared && /\/login/.test(final), `stale session resolves to /login in ${hops} hops with cookie cleared (no loop)`);
  const lp = await fetch(`${base}/login`, { headers: { cookie: gcookie } }).then((r) => r.status);
  ok(lp === 200, "login page renders (200) even with a stale cookie");
}

// create campaign directly in DB (server action needs RSC plumbing; API path is what workers hit)
const slug = "T" + randomBytes(3).toString("hex");
await db.execute({ sql: "INSERT INTO campaigns (slug,name,video_id,min_seconds,keywords,owner_id) VALUES (?,?,?,?,?,?)", args: [slug, "e2e", VIDEO, 120, "kw one\nkw two", uid] });
const cid = Number((await db.execute({ sql: "SELECT id FROM campaigns WHERE slug=?", args: [slug] })).rows[0].id);

// variants (A/B/C) for this campaign
await db.execute({ sql: "INSERT INTO campaign_variants (campaign_id,label,title,thumb_url,position) VALUES (?,?,?,?,?)", args: [cid, "A", "Title A — original", `https://i.ytimg.com/vi/${VIDEO}/hqdefault.jpg`, 0] });
await db.execute({ sql: "INSERT INTO campaign_variants (campaign_id,label,title,thumb_data,position) VALUES (?,?,?,?,?)", args: [cid, "B", "Title B — test", "data:image/jpeg;base64,/9j/4AAQSkZJRg==", 1] });
const vB = Number((await db.execute({ sql: "SELECT id FROM campaign_variants WHERE campaign_id=? AND label='B'", args: [cid] })).rows[0].id);
const lk401 = await fetch(`${base}/api/youtube/lookup?v=${VIDEO}`).then((r) => r.status);
ok(lk401 === 401, "youtube lookup requires sign-in");
const lk400 = await fetch(`${base}/api/youtube/lookup?v=nope`, { headers: { cookie } }).then((r) => r.status);
ok(lk400 === 400, "youtube lookup rejects junk input");
const lkOk = await fetch(`${base}/api/youtube/lookup?v=https://youtu.be/${VIDEO}`, { headers: { cookie } }).then((r) => r.json());
ok(lkOk.videoId === VIDEO && lkOk.thumbnails?.high?.includes(VIDEO), "youtube lookup parses URL and returns thumbnail URLs (title needs network)");

const page = await fetch(`${base}/t/${slug}?src=sg`).then((r) => r.text());
ok(page.includes("Title A — original") && page.includes("Title B — test") && page.includes("Recognise the video"), "worker page shows A/B variants");
ok(page.includes("kw one") || page.includes("kw two"), "worker page renders a keyword");
ok(page.includes("What gets a proof declined") && page.includes("2:00 min"), "worker page shows requirements card with min watch time");
ok(page.includes("Before you verify, confirm you did these") && page.includes("I subscribed to the channel"), "worker page shows the confirmation checklist");
const other = await fetch(`${base}/app/c/${(await db.execute({ sql: "SELECT id FROM campaigns WHERE slug=?", args: [slug] })).rows[0].id}`, { headers: { cookie } }).then((r) => r.status);
ok(other === 200, "owner can open campaign page");
const stranger = await fetch(`${base}/api/auth/register`, { method: "POST", body: new URLSearchParams({ email: "x" + email, password: "correct horse battery" }), redirect: "manual" });
const cookie2 = stranger.headers.get("set-cookie")?.split(";")[0];
const denied = await fetch(`${base}/app/c/${cid}`, { headers: { cookie: cookie2 } }).then((r) => r.status);
ok(denied === 404, "another user cannot open someone else's campaign (404)");
const page2 = await fetch(`${base}/t/${slug}`).then((r) => r.text());
ok((page.includes("kw one")) !== (page2.includes("kw one")), "keyword rotates between visits");

async function submit(bytes, mockOverride, text, variantId, attested = "like,subscribe,comment") {
  // The server reads GEMINI_MOCK_JSON from env; we vary the *image bytes* and rely on a per-request header hook below.
  const fd = new FormData();
  fd.set("slug", slug); fd.set("src", "sg"); fd.set("worker_ref", "tester");
  if (attested) fd.set("attested", attested);
  if (variantId) fd.set("variant_id", String(variantId));
  if (text) fd.set("text", text);
  if (bytes) fd.append("file", new Blob([bytes], { type: "image/png" }), "s.png");
  const r = await fetch(`${base}/api/verify`, { method: "POST", body: fd, headers: mockOverride ? { "x-mock-read": JSON.stringify(mockOverride) } : {} });
  return r.json();
}
const png = (tag) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.from(tag)]);
const good = { has_stats_panel: true, video_id: VIDEO, scpn: "AAAA BBBB CCCC DDDD", frames_dropped: 3, frames_total: 4500, fps: 30, platform: "android", looks_edited: false, confidence: 0.95 };

let r = await submit(png("a0"), good, null, null, "like,subscribe");
ok(r.error && Array.isArray(r.missing) && r.missing.includes("comment"), "missing self-confirmation is rejected server-side (400 with missing list)");
r = await submit(png("a"), good);
ok(r.status === "pass" && /^pw-[a-f0-9]{8}$/.test(r.payout_code), `clean screenshot passes, code ${r.payout_code}`);
const att = (await db.execute({ sql: "SELECT attested FROM submissions WHERE id=?", args: [r.submission_id] })).rows[0].attested;
ok(att === "like,subscribe,comment", "confirmations recorded on the submission");
const code = r.payout_code;
r = await submit(png("a"), good);
ok(r.reason === "duplicate_screenshot", "same bytes rejected as duplicate");
r = await submit(png("b"), { ...good });
ok(r.reason === "reused_playback", "same sCPN with new bytes rejected as reused playback");
r = await submit(png("c"), { ...good, scpn: "NEWNONCE1", video_id: "xxxxxxxxxxx" });
ok(r.reason === "wrong_video", "wrong video id rejected");
r = await submit(png("d"), { ...good, scpn: "NEWNONCE2", frames_total: 900 });
ok(r.reason === "insufficient_watch_time", "900 frames @30fps = 30s < 120s rejected");
ok(Array.isArray(r.checks) && r.checks.some((c) => c.key === "watch" && c.state === "fail" && /90 s more/.test(c.detail)) && r.checks.some((c) => c.key === "video" && c.state === "ok") && /Keep the video playing/.test(r.fix), "fail result carries per-rule checks (video ✓, watch ✗ with '90 s more') and a fix");
r = await submit(png("e"), { ...good, scpn: "NEWNONCE3", has_stats_panel: false, video_id: null, scpn: null });
ok(r.reason === "panel_missing", "no panel rejected");
r = await submit(png("f"), { ...good, scpn: "NEWNONCE4", looks_edited: true, confidence: 0.9 });
ok(r.reason === "edited_screenshot", "edited screenshot rejected");
r = await submit(png("g"), { ...good, scpn: "NEWNONCE5", frames_total: null });
ok(r.status === "review", `unreadable frames -> review (${r.reason})`);
r = await submit(png("h"), { ...good, scpn: "NEWNONCE6" }, null, vB);
ok(r.status === "pass", "second clean session passes");
const sawB = (await db.execute({ sql: "SELECT variant_id FROM submissions WHERE id=?", args: [r.submission_id] })).rows[0].variant_id;
ok(Number(sawB) === vB, "submission records which variant the worker saw");
r = await submit(png("h2"), { ...good, scpn: "NEWNONCE6b" }, null, 999999);
ok(r.status === "pass" && (await db.execute({ sql: "SELECT variant_id FROM submissions WHERE id=?", args: [r.submission_id] })).rows[0].variant_id == null, "variant id from another campaign is ignored");
const cpage = (await fetch(`${base}/app/c/${cid}`, { headers: { cookie } }).then((r) => r.text())).replace(/<!-- -->/g, "");
ok(cpage.includes("what workers reported seeing") && cpage.includes("B · 100%"), "campaign page shows variant split (B 100%)");

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
const sUser = await fetch(`${base}/api/sproutgigs/sync`, { headers: { cookie } }).then((r) => r.json());
ok(sUser.ok === true, "sync endpoint accepts a signed-in user (own campaigns only)");
const health = await fetch(`${base}/api/health`).then((r) => r.json());
ok(health.ok && health.db.ok, "health endpoint ok");

const subs = await db.execute({ sql: "SELECT status, COUNT(*) n FROM submissions WHERE campaign_id=? GROUP BY status", args: [cid] });
console.log("  submissions:", subs.rows.map((x) => `${x.status}=${x.n}`).join(" "));
await db.execute({ sql: "DELETE FROM submissions WHERE campaign_id=?", args: [cid] });
await db.execute({ sql: "DELETE FROM codes WHERE campaign_id=?", args: [cid] });
await db.execute({ sql: "DELETE FROM events WHERE campaign_id=?", args: [cid] });
await db.execute({ sql: "DELETE FROM campaigns WHERE id=?", args: [cid] });
await db.execute({ sql: "DELETE FROM campaign_variants WHERE campaign_id=?", args: [cid] });
await db.execute({ sql: "DELETE FROM users WHERE email IN (?, ?)", args: [email, "x" + email] });
console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
process.exit(fails ? 1 : 0);
