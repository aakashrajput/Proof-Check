import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { dbPersistenceWarning } from "@/lib/db";

export default async function Register({ searchParams }: { searchParams: Promise<{ e?: string }> }) {
  if (await currentUser()) redirect("/app");
  const { e } = await searchParams;
  return (
    <div className="wrap narrow">
      <div className="top"><Link className="brand" href="/">Proof<span>Check</span></Link><Link className="small" href="/login">Sign in</Link></div>
      {dbPersistenceWarning() && <div className="card small" style={{ borderColor: "var(--bad)" }}><b style={{ color: "var(--bad)" }}>Heads-up for the site owner:</b> {dbPersistenceWarning()}</div>}
      <form className="card" method="post" action="/api/auth/register">
        <h2>Create your account</h2>
        <p className="small muted">For employers posting YouTube watch tasks. Workers never need an account.</p>
        <label htmlFor="name">Name (optional)</label>
        <input id="name" name="name" autoComplete="name" />
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" autoComplete="email" required autoFocus />
        <label htmlFor="password">Password (8+ characters)</label>
        <input id="password" name="password" type="password" autoComplete="new-password" minLength={8} required />
        {e && <p style={{ color: "var(--bad)" }}>{e}</p>}
        <div style={{ marginTop: 14 }}><button type="submit">Create account</button></div>
      </form>
      <p className="small muted">Already have one? <Link href="/login">Sign in</Link>.</p>
    </div>
  );
}
