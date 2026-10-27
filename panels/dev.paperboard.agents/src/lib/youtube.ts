// The video a YouTube link points at, so a message can show its thumbnail.

/** The video in a YouTube link, or null. */
export function youTubeId(src: string): string | null {
    if (!URL.canParse(src)) return null;
    const url = new URL(src);
    if (url.protocol !== "https:") return null;
    const host = url.hostname.replace(/^(www|m)\./, "");
    const id =
        host === "youtu.be"
            ? url.pathname.slice(1)
            : host === "youtube.com"
              ? url.pathname === "/watch"
                  ? url.searchParams.get("v")
                  : (/^\/(shorts|embed|live)\/([^/]+)/.exec(url.pathname)?.[2] ?? null)
              : null;
    return id && /^[\w-]{11}$/.test(id) ? id : null;
}
