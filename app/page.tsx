import Link from "next/link";
import { currentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function Home() {
  const u = await currentUser();
  return (
    <div className="wrap">
      <div className="top">
        <div className="brand">Proof<span>Check</span></div>
        <div className="actions">
          {u ? <Link className="btn" href="/app">Open dashboard</Link> : <><Link className="btn secondary" href="/login">Sign in</Link><Link className="btn" href="/register">Start free</Link></>}
        </div>
      </div>

      <section className="hero">
        <p className="eyebrow">Proof-of-work verification for YouTube watch tasks</p>
        <h1 className="display">Stop paying for views that never happened.</h1>
        <p className="lede">You post "watch my video" tasks on SproutGigs, WorkUpJob or Microworkers. Workers send screenshots. Some are real, many are recycled, cropped from a friend, or taken after five seconds. ProofCheck checks every submission against <b>your</b> rules before the worker ever pastes a proof on the job site, and issues a one-time payout code only when it passes.</p>
        <div className="actions">
          {!u && <Link className="btn" href="/register">Create a free account</Link>}
          <a className="btn secondary" href="#how">How it works</a>
        </div>
        <pre className="term hero-term">{`$ verify  task 7Kp2Q  worker @rafi_01
✓ video id ........ dQw4w9WgXcQ   match
✓ playback ........ cpn Qm7xP2kL  first use
✓ watched ......... 150.4 s / min 120 s
✓ proof ........... fresh (copied 41 s ago)
→ VERIFIED   payout code pw-3f9ac1d2 issued`}</pre>
      </section>

      <section className="grid3">
        <div className="card"><h3>Right video</h3><p>The proof must come from your video. Real activity on the wrong video or channel does not pass.</p></div>
        <div className="card"><h3>Real watch time</h3><p>Reads YouTube's own playback data: played ranges and frame counts. Skipping to the end doesn't count.</p></div>
        <div className="card"><h3>No recycled proof</h3><p>Every playback has a unique nonce. The same session can't be paid twice, even if the screenshot is cropped, resized or re-copied.</p></div>
      </section>

      <section id="how" className="card">
        <h2>How it works</h2>
        <ol className="steps big">
          <li><b>Create a campaign.</b> Paste the video URL, set the minimum watch time, add the search keywords you want rotated. You get one task link.</li>
          <li><b>Put the link in your job.</b> Workers open it, see their keyword and the exact requirements, watch the video, and submit proof: the <i>Copy debug info</i> text from YouTube's Stats for nerds panel, or a screenshot of it.</li>
          <li><b>Instant verdict, with reasons.</b> In about a second the worker sees pass or fail and, on a fail, exactly what to fix (<i>"you watched ~60 s, this task needs 120 s"</i>) and a warning that submitting it on the job site anyway will be declined.</li>
          <li><b>Pay on proof.</b> A pass issues a one-time payout code. With SproutGigs connected, tasks carrying a valid code are rated <i>Satisfied</i> automatically; everything else waits for you.</li>
        </ol>
      </section>

      <section className="grid2">
        <div className="card">
          <h3>For employers</h3>
          <ul className="list">
            <li>No manual screenshot review</li>
            <li>Funnel per campaign: opened → submitted → verified, with failure reasons</li>
            <li>Approve or reject any submission by hand; re-issue codes</li>
            <li>Pause, resume or close — mirrored to your SproutGigs job</li>
            <li>Keywords rotated evenly across workers</li>
          </ul>
        </div>
        <div className="card">
          <h3>For workers</h3>
          <ul className="list">
            <li>Nothing to install, no account</li>
            <li>Requirements shown up front, in plain words</li>
            <li>A result in seconds, not a day in a review queue</li>
            <li>Clear fix instructions when something is wrong</li>
            <li>Only the panel reading is kept; screenshots aren't stored</li>
          </ul>
        </div>
      </section>

      <section className="card">
        <h2>What a worker sees when something's wrong</h2>
        <div className="result fail" style={{ marginTop: 8 }}>
          <b>✗ NOT VERIFIED — don't submit this on the job site yet</b>
          <ul className="checks">
            <li className="ok">✓ Right video</li>
            <li className="ok">✓ Fresh playback session</li>
            <li className="bad">✗ Watch time — ~60 s played, this task needs at least 120 s. Keep the video playing for 60 s more, then copy fresh debug info.</li>
          </ul>
          <p className="small">If you submit this proof on the job site as it is, it will be declined. Fix the item above and verify again — it's free to retry.</p>
        </div>
      </section>

      <footer className="small muted" style={{ marginTop: 24 }}>
        ProofCheck · self-hosted · works with SproutGigs, WorkUpJob, Microworkers, RapidWorkers and any link-based task site.
        {!u && <> · <Link href="/register">Create an account</Link></>}
      </footer>
    </div>
  );
}
