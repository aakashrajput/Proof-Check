import Link from "next/link";

export default function Header({ email, crumb }: { email: string; crumb?: string }) {
  return (
    <div className="top">
      <div className="brand"><Link href="/app">Proof<span>Check</span></Link>{crumb ? <span className="muted"> · {crumb}</span> : null}</div>
      <div className="small muted" style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <Link href="/app/settings">Settings</Link>
        <span>{email}</span>
        <form action="/api/auth/logout" method="post" className="inline"><button className="secondary" style={{ padding: "4px 10px", fontSize: 12 }}>Sign out</button></form>
      </div>
    </div>
  );
}
