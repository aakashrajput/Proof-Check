// Accounts: scrypt password hashing, HMAC-signed stateless session cookie, AES-GCM for stored API secrets.
// Signing/encryption key: AUTH_SECRET, falling back to ADMIN_PASSWORD so existing deployments keep working.
import { createHmac, timingSafeEqual, randomBytes, scryptSync, createCipheriv, createDecipheriv, createHash } from "crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { one, type User } from "./db";

export const SESSION_COOKIE = "pc_session";
const SESSION_DAYS = 30;

function secret(): string {
  const s = process.env.AUTH_SECRET || process.env.ADMIN_PASSWORD;
  if (!s) throw new Error("Set AUTH_SECRET (or ADMIN_PASSWORD) in the environment");
  return s;
}
export function authConfigured() { return !!(process.env.AUTH_SECRET || process.env.ADMIN_PASSWORD); }

// ---- passwords ----
export function hashPassword(pw: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}
export function verifyPassword(pw: string, stored: string): boolean {
  const [alg, saltB64, hashB64] = stored.split("$");
  if (alg !== "scrypt" || !saltB64 || !hashB64) return false;
  const hash = scryptSync(pw, Buffer.from(saltB64, "base64"), 64, { N: 16384, r: 8, p: 1 });
  const want = Buffer.from(hashB64, "base64");
  return hash.length === want.length && timingSafeEqual(hash, want);
}

// ---- sessions: "<uid>.<exp>.<sig>" ----
function sign(payload: string) { return createHmac("sha256", secret()).update(payload).digest("base64url"); }
export function makeSession(userId: number): string {
  const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400;
  const payload = `${userId}.${exp}`;
  return `${payload}.${sign(payload)}`;
}
export function parseSession(token: string | undefined | null): number | null {
  if (!token || !authConfigured()) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [uid, exp, sig] = parts;
  const want = sign(`${uid}.${exp}`);
  const a = Buffer.from(sig), b = Buffer.from(want);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  if (Number(exp) < Math.floor(Date.now() / 1000)) return null;
  const id = Number(uid);
  return Number.isInteger(id) && id > 0 ? id : null;
}
export function sessionCookieOptions(secure: boolean) {
  return { httpOnly: true, sameSite: "lax" as const, secure, path: "/", maxAge: SESSION_DAYS * 86400 };
}

/** Current signed-in user, or null. Server components / route handlers only. */
export async function currentUser(): Promise<User | null> {
  const c = await cookies();
  const id = parseSession(c.get(SESSION_COOKIE)?.value);
  if (!id) return null;
  try { return await one<User>("SELECT * FROM users WHERE id = ?", [id]); }
  catch (e) { console.error("currentUser: database error", e); return null; }   // a broken DB must not 500 public pages
}

/**
 * For pages under /app. Returns the user, or redirects. A cookie that verifies but points at a user
 * that no longer exists (e.g. created before the database was attached) is cleared via the logout
 * route so the browser can't ping-pong between /app and /login.
 */
export async function requireUser(nextPath = "/app"): Promise<User> {
  const c = await cookies();
  const raw = c.get(SESSION_COOKIE)?.value;
  const id = parseSession(raw);
  if (!id) redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  let u: User | null = null;
  try { u = await one<User>("SELECT * FROM users WHERE id = ?", [id]); }
  catch (e) { redirect(`/login?e=${encodeURIComponent("Database error: " + String((e as Error).message).slice(0, 160))}`); }
  if (!u) redirect(`/api/auth/logout?next=${encodeURIComponent("/login?e=" + encodeURIComponent("Your session was out of date. Please sign in again."))}`);
  return u!;
}

// ---- secrets at rest (per-user SproutGigs API secret) ----
function key() { return createHash("sha256").update("proofcheck-enc:" + secret()).digest(); }
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `v1.${iv.toString("base64url")}.${enc.toString("base64url")}.${c.getAuthTag().toString("base64url")}`;
}
export function decrypt(blob: string): string {
  const [v, iv, enc, tag] = blob.split(".");
  if (v !== "v1") throw new Error("bad secret blob");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(enc, "base64url")), d.final()]).toString("utf8");
}

export function validEmail(e: string) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) && e.length <= 200; }
