// Local poller: hits the sync endpoint every N seconds so SproutGigs tasks get rated without Vercel cron.
// Usage: BASE_URL=http://localhost:3000 CRON_SECRET=xxx node scripts/poll.mjs [intervalSeconds]
const base = process.env.BASE_URL || "http://localhost:3000";
const secret = process.env.CRON_SECRET;
const every = Number(process.argv[2] || 10) * 1000;
if (!secret) { console.error("CRON_SECRET required"); process.exit(1); }

async function tick() {
  try {
    const r = await fetch(`${base}/api/sproutgigs/sync`, { headers: { authorization: `Bearer ${secret}` } });
    const j = await r.json();
    const line = (j.reports ?? []).map((x) => `${x.campaign}: seen ${x.seen} ok ${x.ok} unmatched ${x.unmatched} skipped ${x.skipped}${x.errors.length ? " ERR " + x.errors.join("; ") : ""}`).join(" | ");
    console.log(new Date().toISOString(), r.status, line || JSON.stringify(j));
  } catch (e) { console.error(new Date().toISOString(), "poll failed:", e.message); }
}
await tick();
setInterval(tick, every);
