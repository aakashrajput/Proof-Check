import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { saveSettings, testSproutGigs } from "../actions";
import Header from "../Header";

export const dynamic = "force-dynamic";

export default async function Settings({ searchParams }: { searchParams: Promise<{ saved?: string; ok?: string; e?: string }> }) {
  const u = await currentUser();
  if (!u) redirect("/login");
  const { saved, ok, e } = await searchParams;
  const hasSecret = !!u.sg_secret_enc;
  return (
    <div className="wrap narrow">
      <Header email={u.email} crumb="Settings" />
      {saved && <div className="card" style={{ borderColor: "var(--ok)" }}>Saved.</div>}
      {ok && <div className="card" style={{ borderColor: "var(--ok)" }}>{ok}</div>}
      {e && <div className="card" style={{ borderColor: "var(--bad)" }}>{e}</div>}

      <form className="card" action={saveSettings}>
        <h2>Profile</h2>
        <label htmlFor="name">Name</label><input id="name" name="name" defaultValue={u.name ?? ""} />
        <label>Email</label><input value={u.email} disabled />

        <h2 style={{ marginTop: 22 }}>SproutGigs auto-rating</h2>
        <p className="small muted">In SproutGigs go to <b>Account Settings → API</b>, copy your user ID and generate an API secret. The secret is stored encrypted and never shown again.</p>
        <label htmlFor="sg_user_id">SproutGigs user ID</label><input id="sg_user_id" name="sg_user_id" defaultValue={u.sg_user_id ?? ""} autoComplete="off" />
        <label htmlFor="sg_api_secret">API secret {hasSecret ? <span className="ok">(saved — leave blank to keep)</span> : null}</label>
        <input id="sg_api_secret" name="sg_api_secret" type="password" autoComplete="new-password" placeholder={hasSecret ? "••••••••••••" : ""} />
        {hasSecret && <label className="small" style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" name="clear_secret" value="1" style={{ width: "auto" }} /> Remove saved credentials</label>}
        <div className="actions" style={{ marginTop: 14 }}><button type="submit">Save</button></div>
      </form>
      {hasSecret && <form className="card" action={testSproutGigs}><h3>Connection test</h3><p className="small muted">Calls <code>users/get-balances.php</code> with your saved credentials.</p><button className="secondary">Test SproutGigs connection</button></form>}

      <div className="card small muted">
        <h3>How auto-rating works</h3>
        <p>Put the SproutGigs <b>job ID</b> on a campaign. Each sync pulls that job's unrated tasks, finds the <code>pw-…</code> code in each proof, and rates <b>ok</b> when the code is valid, unused, and belongs to that campaign. Proofs without a valid code are left for you to rate by hand. Use <b>Sync SproutGigs now</b> on the campaign page, or run the poller for continuous syncing.</p>
      </div>
    </div>
  );
}
