// Optional: resolves a video to its channel using YouTube Data API v3 (YOUTUBE_API_KEY).
// Without a key, we fall back to the public oEmbed endpoint (title + channel name, no handle).

export function parseVideoId(input: string): string | null {
  const s = input.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  try {
    const u = new URL(s);
    if (u.hostname.includes("youtu.be")) return u.pathname.slice(1, 12) || null;
    if (u.searchParams.get("v")) return u.searchParams.get("v");
    const m = u.pathname.match(/\/(shorts|embed|live)\/([A-Za-z0-9_-]{11})/);
    if (m) return m[2];
  } catch { /* not a url */ }
  return null;
}

export type VideoMeta = {
  videoId: string; title: string | null; channelTitle: string | null; channelHandle: string | null;
  durationSeconds: number | null; thumbnails: { default: string; medium: string; high: string; maxres: string }; source: "api" | "oembed" | "none";
};

export function thumbs(videoId: string) {
  const b = `https://i.ytimg.com/vi/${videoId}`;
  return { default: `${b}/default.jpg`, medium: `${b}/mqdefault.jpg`, high: `${b}/hqdefault.jpg`, maxres: `${b}/maxresdefault.jpg` };
}

/** ISO-8601 duration (PT1H2M3S) → seconds */
export function isoDuration(s: string | undefined | null): number | null {
  const m = s?.match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return null;
  return (+(m[1] ?? 0)) * 86400 + (+(m[2] ?? 0)) * 3600 + (+(m[3] ?? 0)) * 60 + (+(m[4] ?? 0));
}

export async function resolveVideo(videoId: string): Promise<VideoMeta> {
  const key = process.env.YOUTUBE_API_KEY;
  const base: VideoMeta = { videoId, title: null, channelTitle: null, channelHandle: null, durationSeconds: null, thumbnails: thumbs(videoId), source: "none" };
  const to = (ms: number) => AbortSignal.timeout(ms);
  try {
    if (key) {
      const v = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails&id=${videoId}&key=${key}`, { signal: to(6000) }).then((r) => r.json());
      const it = v?.items?.[0];
      if (it?.snippet) {
        let handle: string | null = null;
        try {
          const c = await fetch(`https://www.googleapis.com/youtube/v3/channels?part=snippet&id=${it.snippet.channelId}&key=${key}`, { signal: to(6000) }).then((r) => r.json());
          const custom = c?.items?.[0]?.snippet?.customUrl as string | undefined;
          if (custom) handle = custom.startsWith("@") ? custom : `@${custom}`;
        } catch { /* handle optional */ }
        const t = it.snippet.thumbnails ?? {};
        return { ...base, title: it.snippet.title ?? null, channelTitle: it.snippet.channelTitle ?? null, channelHandle: handle,
          durationSeconds: isoDuration(it.contentDetails?.duration), source: "api",
          thumbnails: { default: t.default?.url ?? base.thumbnails.default, medium: t.medium?.url ?? base.thumbnails.medium, high: t.high?.url ?? base.thumbnails.high, maxres: t.maxres?.url ?? t.standard?.url ?? base.thumbnails.maxres } };
      }
    }
    const o = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`, { signal: to(6000) }).then((r) => r.json());
    return { ...base, title: o?.title ?? null, channelTitle: o?.author_name ?? null, source: o?.title ? "oembed" : "none" };
  } catch {
    return base;
  }
}
