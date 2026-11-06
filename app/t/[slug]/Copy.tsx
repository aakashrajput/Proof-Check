"use client";
import { useState } from "react";

export default function Copy({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button className="secondary" type="button" onClick={async () => {
      try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* ignore */ }
    }}>{done ? "Copied" : "Copy"}</button>
  );
}
