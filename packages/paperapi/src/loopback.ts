// Catching one browser redirect to a loopback address on the person's
// device. An installed-app sign-in (OAuth with a redirect such as
// http://localhost:1455/auth/callback) sends the browser to localhost, which
// is the person's device, not the computer the panel's program runs on.
// The Paperboard app listens there once and hands the address the browser
// landed on to the panel, which passes it to its program. The panel frame
// asks its shell through requestShell.
import { requestShell } from "./shellRequest";

export type LoopbackRedirectResult =
    /** the full address the browser requested, e.g. "http://localhost:1455/auth/callback?code=...&state=..." */
    | { status: "caught"; url: string }
    /** the panel runs on this device: the program it started receives the redirect itself */
    | { status: "local" };

export type LoopbackRedirectErrorCode = "invalid-request" | "unavailable" | "in-use" | "busy" | "canceled" | "timeout" | "failed";

const ERROR_CODES = new Set<LoopbackRedirectErrorCode>(["invalid-request", "unavailable", "in-use", "busy", "canceled", "timeout", "failed"]);

export class LoopbackRedirectError extends Error {
    constructor(
        readonly code: LoopbackRedirectErrorCode,
        message: string,
    ) {
        super(message);
        this.name = "LoopbackRedirectError";
    }
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** why the address is not a loopback redirect, or null when it is */
function redirectUriProblem(redirectUri: unknown): string | null {
    if (typeof redirectUri !== "string" || !redirectUri) return "The redirect address is missing";
    if (redirectUri.length > 2048) return "The redirect address is longer than 2048 characters";
    let url: URL;
    try {
        url = new URL(redirectUri);
    } catch {
        return `"${redirectUri.slice(0, 200)}" is not an address`;
    }
    if (url.protocol !== "http:") return "The redirect address must start with http://";
    if (!LOOPBACK_HOSTS.has(url.hostname)) return "The redirect address must be on localhost, 127.0.0.1 or [::1]";
    if (url.username || url.password) return "The redirect address cannot hold a user name or password";
    if (url.hash) return "The redirect address cannot hold a fragment (#)";
    const port = Number(url.port);
    if (!url.port || !Number.isInteger(port) || port < 1024 || port > 65535) return "The redirect address needs a port from 1024 to 65535";
    if (!url.pathname.startsWith("/")) return "The redirect address needs a path";
    return null;
}

/**
 * Catches the next browser request for `redirectUri` on the person's device
 * and resolves with the full address it asked for. Resolves `{ status:
 * "local" }` without listening when the panel runs on this device. Throws
 * LoopbackRedirectError: `unavailable` in a widget, outside Paperboard or in
 * Paperboard in a web browser; `in-use` when another program holds the
 * port; `busy` while this page or another panel already waits on it;
 * `canceled` when `signal` aborts; `timeout` after 15 minutes.
 */
export function catchLoopbackRedirect(redirectUri: string, options: { signal?: AbortSignal } = {}): Promise<LoopbackRedirectResult> {
    const problem = redirectUriProblem(redirectUri);
    if (problem) return Promise.reject(new LoopbackRedirectError("invalid-request", problem));
    return requestShell<LoopbackRedirectResult>({
        type: "paperboard:loopback-redirect",
        fields: { redirectUri },
        unavailable: () => new LoopbackRedirectError("unavailable", "Catching a sign-in redirect needs a panel shown in Paperboard"),
        widget: () => new LoopbackRedirectError("unavailable", "A widget cannot catch a sign-in redirect; open its panel instead"),
        busy: () => new LoopbackRedirectError("busy", "This page is already waiting for a sign-in redirect"),
        cancel: { signal: options.signal, error: () => new LoopbackRedirectError("canceled", "Waiting for the sign-in redirect was canceled") },
        parse: (result: any) => {
            if (result?.status === "caught" && typeof result.url === "string" && result.url) return { status: "caught", url: result.url };
            if (result?.status === "local") return { status: "local" };
            if (result?.status === "failed") {
                const code = ERROR_CODES.has(result.code) ? (result.code as LoopbackRedirectErrorCode) : "failed";
                return new LoopbackRedirectError(code, String(result.message ?? "Catching the sign-in redirect failed"));
            }
            return new LoopbackRedirectError("failed", "The shell sent a malformed loopback redirect result");
        },
    });
}
