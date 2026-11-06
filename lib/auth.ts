import { createHmac, timingSafeEqual } from "crypto";

export const COOKIE = "pc_admin";

function secret() { return process.env.ADMIN_PASSWORD || ""; }

export function token(): string {
  return createHmac("sha256", secret()).update("proofcheck-admin").digest("hex");
}

export function validToken(t: string | undefined | null): boolean {
  if (!t || !secret()) return false;
  const a = Buffer.from(t), b = Buffer.from(token());
  return a.length === b.length && timingSafeEqual(a, b);
}

export function checkPassword(p: string): boolean {
  const s = secret();
  if (!s) return false;
  const a = Buffer.from(p), b = Buffer.from(s);
  return a.length === b.length && timingSafeEqual(a, b);
}
