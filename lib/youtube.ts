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

export async function resolveVideo(videoId: string): Promise<{ title: string | null; channelTitle: string | null; channelHandle: string | null }> {
  const key = process.env.YOUTUBE_API_KEY;
  try {
    if (key) {
      const v = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoId}&key=${key}`).then((r) => r.json());
      const sn = v?.items?.[0]?.snippet;
      if (!sn) return { title: null, channelTitle: null, channelHandle: null };
      let handle: string | null = null;
      const c = await fetch(`https://www.googleapis.com/youtube/v3/channels?part=snippet&id=${sn.channelId}&key=${key}`).then((r) => r.json());
      const custom = c?.items?.[0]?.snippet?.customUrl as string | undefined;
      if (custom) handle = custom.startsWith("@") ? custom : `@${custom}`;
      return { title: sn.title ?? null, channelTitle: sn.channelTitle ?? null, channelHandle: handle };
    }
    const o = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`).then((r) => r.json());
    return { title: o?.title ?? null, channelTitle: o?.author_name ?? null, channelHandle: null };
  } catch {
    return { title: null, channelTitle: null, channelHandle: null };
  }
}
