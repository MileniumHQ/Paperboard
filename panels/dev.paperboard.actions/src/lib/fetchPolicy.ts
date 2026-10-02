// Fetch scheme rule for action steps. Panels are first-party and there is
// no per-panel egress declaration; the daemon serves one fixed panel CSP.
// This keeps a step error honest instead of a browser-level network
// failure: https anywhere, http only to this machine.
export function fetchRefusal(rawUrl: string): string | null {
    let url: URL;
    try {
        url = new URL(String(rawUrl ?? ""));
    } catch (err) {
        console.debug(
            `[actions] refused a malformed fetch URL: ${String(rawUrl).slice(0, 120)}`,
            err,
        );
        return "malformed URL";
    }
    const host = url.hostname.toLowerCase();
    if (url.protocol === "http:") {
        // plain http only ever reaches this machine
        return isLoopback(host)
            ? null
            : `http is only allowed to loopback hosts, got ${host}`;
    }
    if (url.protocol !== "https:") {
        return `only https is allowed, got ${url.protocol}//${host}`;
    }
    return null;
}

function isLoopback(host: string): boolean {
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
}
