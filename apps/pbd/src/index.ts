// pbd.lc: forwards a short path to the URL stored under it in KV.

export interface Env {
    LINKS: Pick<KVNamespace, "get">;
}

// longer paths are never looked up: no link is that long
const MAX_PATH = 64;

/** "/Beta2/" and "/beta2" are the same link; "/" is the bare domain. */
export function linkKey(pathname: string): string | null {
    if (pathname.length > MAX_PATH) return null;
    const key = pathname.toLowerCase().replace(/\/+$/, "");
    return key === "" ? "/" : key;
}

/** A stored target is only followed when it is an absolute https URL. */
export function parseTarget(value: string): URL | null {
    const url = URL.parse(value.trim());
    return url?.protocol === "https:" ? url : null;
}

const text = (body: string, status: number) =>
    new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        if (request.method !== "GET" && request.method !== "HEAD") {
            return new Response(null, { status: 405, headers: { allow: "GET, HEAD" } });
        }
        const key = linkKey(new URL(request.url).pathname);
        if (key === null) return text("No such link.", 404);

        let value: string | null;
        try {
            value = await env.LINKS.get(key);
        } catch (err) {
            // unavailable is not "no such link"
            console.error(`[pbd] link lookup failed for ${key}:`, err);
            return text("Links are unavailable right now. Try again in a moment.", 503);
        }
        if (value === null) return text("No such link.", 404);

        const target = parseTarget(value);
        if (!target) {
            console.error(`[pbd] link ${key} has an invalid target`);
            return text("This link is broken.", 500);
        }
        // 302, not 301: links are edited in KV and browsers cache 301s forever
        return new Response(null, { status: 302, headers: { location: target.href, "cache-control": "no-store" } });
    },
};
