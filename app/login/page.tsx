import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { dbPersistenceWarning } from "@/lib/db";

export default async function Login({ searchParams }: { searchParams: Promise<{ next?: string; e?: string }> }) {
  if (await currentUser()) redirect("/app");
  const { next, e } = await searchParams;
  return (
    <div className="wrap narrow">
      <div className="top"><Link className="brand" href="/">Proof<span>Check</span></Link><Link className="small" href="/register">Create an account</Link></div>
      {dbPersistenceWarning() && <div className="card small" style={{ borderColor: "var(--bad)" }}><b style={{ color: "var(--bad)" }}>Heads-up for the site owner:</b> {dbPersistenceWarning()}</div>}
      <form className="card" method="post" action="/api/auth/login">
        <h2>Sign in</h2>
        <input type="hidden" name="next" value={next ?? "/app"} />
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" autoComplete="email" required autoFocus />
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required />
        {e && <p style={{ color: "var(--bad)" }}>{e}</p>}
        <div style={{ marginTop: 14 }}><button type="submit">Sign in</button></div>
      </form>
      <p className="small muted">New here? <Link href="/register">Create an account</Link> — it takes ten seconds.</p>
    </div>
  );
}
