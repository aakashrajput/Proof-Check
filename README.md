# ProofCheck

Self-hosted proof-of-work verifier for paid YouTube watch tasks (SproutGigs, WorkUpJob, Microworkers…).
Workers prove the watch with YouTube's **Stats for nerds** panel — either the **"Copy debug info"** text (preferred: exact, no AI cost,
includes true played time) or a **screenshot** (read by Gemini Flash), or both. ProofCheck checks it and hands out a one-time payout code.
If a SproutGigs job is linked, it rates submissions `ok` automatically when the proof contains a valid code.

## Two proof paths

| | Debug-info text | Screenshot |
|---|---|---|
| How the worker gets it | Stats for nerds → **Copy debug info** → paste | Screenshot of the panel |
| Parsed by | `lib/debugtext.ts` (JSON or pasted panel lines) | Gemini Flash vision (`lib/gemini.ts`) |
| Watch time | `vpl` played ranges summed (skips excluded), fallback `vct`, fallback frames/fps | frames ÷ fps |
| Extra checks | freshness (`TEXT_MAX_AGE_HOURS`), played ≤ duration, cpn format | tamper/edit flag, read confidence |
| Cost | free | ~$0.0005–0.002 per check |

Per campaign, **Accepted proof** = `either` (default) · `text` · `screenshot` · `both`. When both are submitted they must carry the
same video ID **and** the same cpn nonce, otherwise `proof_mismatch`.

## What it checks, in order

1. **Exact duplicate** — SHA-256 of file bytes / normalized text seen before → `duplicate_screenshot` / `duplicate_text`
2. **Text parse** — must contain a video id + cpn; invalid or self-contradicting → `text_unreadable` / `text_invalid`; too old → `stale_proof`
3. **Screenshot read** — panel visible with `Video ID / sCPN` and `Viewport / Frames` → else `panel_missing`; both present must agree → `proof_mismatch`
4. **Reused playback** — the cpn nonce was already used for a pass (survives crop/resize/recompress/re-copy) → `reused_playback`
5. **Right video** — video ID must equal the campaign's → `wrong_video`
6. **Tampering** (screenshot) — `edited_screenshot`, or `review` when unsure
7. **Watch time** — seconds ≥ min seconds and/or frames ≥ min frames → `insufficient_watch_time`
8. **Pass** → payout code `pw-xxxxxxxx`, usable once

Anything ambiguous lands in **review**; you approve/reject from the admin page.

## Run locally (5 minutes)

```bash
npm install
cp .env.example .env.local      # fill ADMIN_PASSWORD + GEMINI_API_KEY (+ SproutGigs keys if wanted)
npm run dev                     # http://localhost:3000/admin
```

Optional: `node scripts/seed-demo.mjs` creates a demo campaign at `/t/DEMO1`.

### SproutGigs auto-rating locally

```bash
CRON_SECRET=anything BASE_URL=http://localhost:3000 node scripts/poll.mjs 10   # polls every 10s
```

## Deploy to Vercel

1. Push this folder to GitHub, import in Vercel.
2. Database: SQLite files don't persist on Vercel. Create a free [Turso](https://turso.tech) DB and set
   `DATABASE_URL=libsql://…turso.io` and `DATABASE_AUTH_TOKEN`.
3. Set the env vars from `.env.example`. `CRON_SECRET` is required for the cron in `vercel.json`
   (every minute on Pro; on Hobby, run `scripts/poll.mjs` from your laptop or a $3 VPS instead).

## SproutGigs setup

1. SproutGigs → Account Settings → generate API secret. Set `SG_USER_ID` and `SG_API_SECRET`.
2. Post your job on SproutGigs. In the job description paste the task link from the campaign page
   (`https://your-app/t/SLUG?src=sg`) and ask workers to submit the payout code as proof.
3. Put the SproutGigs **job ID** in the campaign. Each sync:
   - pulls `get-unrated-tasks.php` for the job (1 req/s, 429-aware)
   - finds `pw-…` codes in the proof text, matches an **unused** code from **this** campaign → rates `ok`, burns the code
   - anything else follows `SG_UNMATCHED_ACTION`: `skip` (default — you rate manually), `revise`, or `not_ok`
   - every rating is recorded in `sg_ratings` so a task is never rated twice
4. Pause / Resume / Close on the campaign page mirrors to the SproutGigs job (pause is documented;
   `job-resume.php` / `job-stop.php` are inferred from the docs' naming — confirm the exact paths in
   https://sproutgigs.com/api/documentation.php before relying on them).

> Rating is blocked by SproutGigs while a job is `PAUSED_ADMIN` / `PENDING_REVIEW` / `PENDING_RESTART`, and a run of `not_ok`
> ratings can auto-pause the job. Errors show up in the "last sync" box on the campaign page.

## Tuning

- **Text first**: set Accepted proof = `text` if you want zero AI spend; workers on the YouTube app and web both have "Copy debug info".
- **Min watch time**: set seconds (needs fps readable) and/or min frames (works even when fps isn't visible). 2 min @ 30fps ≈ 3,600 frames.
- **Model**: `GEMINI_MODEL=gemini-2.5-flash-lite` is cheaper; `gemini-2.5-flash` reads messy phone screenshots better.
- **Keywords**: one per line, rotated evenly per page view.
- Worker page URL params: `?src=sg|wuj|mw` for traffic source, `&w=username` prefills the worker id.

## Tests

```bash
ADMIN_PASSWORD=x CRON_SECRET=cron ALLOW_MOCK_HEADER=1 npm run build && npm start &
BASE_URL=http://localhost:3000 ADMIN_PASSWORD=x CRON_SECRET=cron node scripts/e2e.mjs
```

`ALLOW_MOCK_HEADER=1` lets the test inject a fake panel read via `x-mock-read`; never set it in production.

## Layout

```
app/t/[slug]/          worker task page (+ UploadForm, Copy)
app/api/verify         screenshot → verification pipeline
app/api/sproutgigs/sync  cron / poller endpoint
app/admin              dashboard, campaign detail, login (cookie, ADMIN_PASSWORD)
lib/verify.ts          the rules (merges text + screenshot evidence)
lib/debugtext.ts       "Copy debug info" / pasted-panel parser
lib/gemini.ts          Stats-for-nerds screenshot extraction (structured JSON)
lib/sproutgigs.ts      API client, throttle, code matching, rating
lib/db.ts              libSQL (SQLite locally / Turso on Vercel), schema auto-created
scripts/               poll.mjs, seed-demo.mjs, e2e.mjs
```

## Not included (yet)

Payments/credits, multi-user accounts, Bengali UI, SproutGigs webhooks (polling is used), WorkUpJob API (none exists — use the results table).
