// Seeds one demo campaign with a few submissions so the admin UI has something to show.
import { createClient } from "@libsql/client";
const db = createClient({ url: process.env.DATABASE_URL || "file:./data/proofcheck.db" });
await db.execute({ sql: "INSERT OR IGNORE INTO campaigns (slug,name,video_id,video_title,channel_title,channel_handle,min_seconds,keywords,sg_job_id) VALUES (?,?,?,?,?,?,?,?,?)",
  args: ["DEMO1", "Demo campaign", "dQw4w9WgXcQ", "Never Gonna Give You Up", "Rick Astley", "@RickAstleyYT", 120, "best 80s pop song\nclassic 80s music video", "123456"] });
const id = (await db.execute({ sql: "SELECT id FROM campaigns WHERE slug=?", args: ["DEMO1"] })).rows[0].id;
await db.execute({ sql: "INSERT INTO submissions (campaign_id,worker_ref,src,sha256,scpn,video_id_read,frames_total,fps,watch_seconds,status,reason,payout_code) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
  args: [id, "worker_01", "sg", "seed-a", "AAAABBBBCCCC", "dQw4w9WgXcQ", 4500, 30, 150, "pass", "verified", "pw-1a2b3c4d"] });
await db.execute({ sql: "INSERT INTO submissions (campaign_id,worker_ref,src,sha256,scpn,video_id_read,frames_total,fps,watch_seconds,status,reason) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
  args: [id, "worker_02", "sg", "seed-b", "ZZZZ", "xk9Qv1p2LmE", 4000, 30, 133, "fail", "wrong_video"] });
await db.execute({ sql: "INSERT INTO submissions (campaign_id,worker_ref,src,sha256,status,reason) VALUES (?,?,?,?,?,?)", args: [id, "worker_03", "wuj", "seed-c", "review", "frames_unreadable"] });
for (const k of ["opened", "opened", "opened", "submitted", "submitted", "submitted", "verified", "rejected"])
  await db.execute({ sql: "INSERT INTO events (campaign_id,kind,src) VALUES (?,?,?)", args: [id, k, "sg"] });
console.log("seeded campaign", id, "→ /t/DEMO1");
