export default async function Login({ searchParams }: { searchParams: Promise<{ next?: string; e?: string }> }) {
  const { next, e } = await searchParams;
  return (
    <div className="wrap narrow">
      <div className="top"><div className="brand">Proof<span>Check</span></div></div>
      <form className="card" method="post" action="/api/admin/login">
        <h2>Admin sign in</h2>
        <input type="hidden" name="next" value={next ?? "/admin"} />
        <label>Password (ADMIN_PASSWORD)</label>
        <input type="password" name="password" autoFocus />
        {e && <p style={{ color: "var(--bad)" }}>Wrong password.</p>}
        <div style={{ marginTop: 12 }}><button type="submit">Sign in</button></div>
      </form>
    </div>
  );
}
