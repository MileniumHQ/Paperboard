// Catching one browser redirect to a loopback address for a panel: the
// rules a redirect address must meet, and the answer the shell gives the
// panel frame. Checked again by every side that acts on the address (the
// renderer before routing it, main before listening), never trusted from
// the side that sent it.

export const LOOPBACK_REDIRECT_TIMEOUT_MS = 15 * 60_000;
export const LOOPBACK_REDIRECT_URI_MAX = 2048;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export type LoopbackRedirectFailureCode = "invalid-request" | "unavailable" | "in-use" | "busy" | "canceled" | "timeout" | "failed";

export type PanelLoopbackRedirectResult =
    | { status: "caught"; url: string }
    | { status: "local" }
    | { status: "failed"; code: LoopbackRedirectFailureCode; message: string };

/**
 * The redirect address as a URL, or why it is refused: http, a loopback
 * host (localhost, 127.0.0.1 or [::1]), an explicit port from 1024 to
 * 65535 and a path, with no user name or fragment.
 */
export function parseLoopbackRedirectUri(raw: unknown): URL | string {
    if (typeof raw !== "string" || !raw) return "The redirect address is missing";
    if (raw.length > LOOPBACK_REDIRECT_URI_MAX) return `The redirect address is longer than ${LOOPBACK_REDIRECT_URI_MAX} characters`;
    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        return `"${raw.slice(0, 200)}" is not an address`;
    }
    if (url.protocol !== "http:") return "The redirect address must start with http://";
    if (!LOOPBACK_HOSTS.has(url.hostname)) return "The redirect address must be on localhost, 127.0.0.1 or [::1]";
    if (url.username || url.password) return "The redirect address cannot hold a user name or password";
    if (url.hash) return "The redirect address cannot hold a fragment (#)";
    const port = Number(url.port);
    if (!url.port || !Number.isInteger(port) || port < 1024 || port > 65535) {
        return "The redirect address needs a port from 1024 to 65535";
    }
    if (!url.pathname.startsWith("/")) return "The redirect address needs a path";
    return url;
}
