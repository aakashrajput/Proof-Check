// Reads YouTube "Stats for nerds" screenshots with Gemini Flash vision.
// Set GEMINI_API_KEY. Optional GEMINI_MODEL (default gemini-2.5-flash).
// Set GEMINI_MOCK_JSON (path or inline JSON) to bypass the API in tests.

export type PanelRead = {
  has_stats_panel: boolean;
  video_id: string | null;        // 11-char YouTube id from "Video ID / sCPN"
  scpn: string | null;            // the nonce after the slash, spaces removed
  frames_dropped: number | null;  // from "Viewport / Frames: ... N dropped of M"
  frames_total: number | null;
  fps: number | null;             // from "Current / Optimal Res: WxH@FPS"
  current_res: string | null;
  channel_name: string | null;    // if visible anywhere (watch page)
  video_title: string | null;
  platform: "desktop" | "android" | "ios" | "unknown";
  looks_edited: boolean;          // inconsistent fonts, misaligned text, odd kerning
  edit_notes: string | null;
  confidence: number;             // 0..1 overall read confidence
};

const PROMPT = `You are reading screenshots of YouTube. One of them should contain the "Stats for nerds" overlay panel.
Extract the panel's values EXACTLY as printed. Do not guess values that are not visible.

Fields:
- has_stats_panel: true only if the Stats for nerds panel is visible and legible.
- video_id: the 11-character id before the "/" on the "Video ID / sCPN" (or "Video ID / CPN") line. null if not visible.
- scpn: the nonce after the "/" on that same line, with all spaces removed. null if not visible.
- frames_dropped and frames_total: from the "Viewport / Frames" line, pattern "N dropped of M". On mobile this may be "Dropped Frames" with only N; then frames_total=null.
- fps: the frame rate number after "@" in "Current / Optimal Res" (e.g. "1280x720@30" -> 30). null if absent.
- current_res: the full current resolution token, e.g. "1280x720@30".
- channel_name, video_title: only if clearly visible in any screenshot (e.g. on the watch page). Otherwise null.
- platform: "desktop" for the web player, "android"/"ios" for the mobile apps, else "unknown".
- looks_edited: true if any text looks pasted, mismatched in font/size/alignment/colour, or digits look altered; edit_notes explains why.
- confidence: 0..1 for how sure you are about video_id, scpn and frames.

Return ONLY JSON matching this schema, no prose.`;

const SCHEMA = {
  type: "OBJECT",
  properties: {
    has_stats_panel: { type: "BOOLEAN" },
    video_id: { type: "STRING", nullable: true },
    scpn: { type: "STRING", nullable: true },
    frames_dropped: { type: "INTEGER", nullable: true },
    frames_total: { type: "INTEGER", nullable: true },
    fps: { type: "NUMBER", nullable: true },
    current_res: { type: "STRING", nullable: true },
    channel_name: { type: "STRING", nullable: true },
    video_title: { type: "STRING", nullable: true },
    platform: { type: "STRING", enum: ["desktop", "android", "ios", "unknown"] },
    looks_edited: { type: "BOOLEAN" },
    edit_notes: { type: "STRING", nullable: true },
    confidence: { type: "NUMBER" },
  },
  required: ["has_stats_panel", "platform", "looks_edited", "confidence"],
};

export async function readPanel(images: { bytes: Buffer; mime: string }[], mockOverride?: string | null): Promise<PanelRead> {
  if (mockOverride && process.env.ALLOW_MOCK_HEADER === "1") return normalize(JSON.parse(mockOverride));
  const mock = process.env.GEMINI_MOCK_JSON;
  if (mock) return normalize(JSON.parse(mock.trim().startsWith("{") ? mock : (await import("fs")).readFileSync(mock, "utf8")));

  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set");
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

  const parts: unknown[] = [{ text: PROMPT }];
  for (const img of images) parts.push({ inline_data: { mime_type: img.mime, data: img.bytes.toString("base64") } });

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: { temperature: 0, responseMimeType: "application/json", responseSchema: SCHEMA },
    }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const text: string = data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";
  if (!text) throw new Error("Gemini returned no content");
  return normalize(JSON.parse(text));
}

function normalize(j: Partial<PanelRead>): PanelRead {
  const vid = (j.video_id ?? "").toString().trim();
  const scpn = (j.scpn ?? "").toString().replace(/\s+/g, "").trim();
  return {
    has_stats_panel: !!j.has_stats_panel,
    video_id: /^[A-Za-z0-9_-]{11}$/.test(vid) ? vid : vid || null,
    scpn: scpn || null,
    frames_dropped: numOrNull(j.frames_dropped),
    frames_total: numOrNull(j.frames_total),
    fps: numOrNull(j.fps),
    current_res: j.current_res ?? null,
    channel_name: j.channel_name ?? null,
    video_title: j.video_title ?? null,
    platform: (j.platform as PanelRead["platform"]) ?? "unknown",
    looks_edited: !!j.looks_edited,
    edit_notes: j.edit_notes ?? null,
    confidence: typeof j.confidence === "number" ? j.confidence : 0.5,
  };
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
