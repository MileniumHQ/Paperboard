// A panel frame asks the shell to catch one browser redirect to a loopback
// address with { type: "paperboard:loopback-redirect", generation, requestId,
// redirectUri }, and takes it back with "paperboard:loopback-redirect-cancel"
// (same requestId). The shell answers on the same frame with
// "paperboard:loopback-redirect-result".
//
// Whether there is anything to catch is decided here: a panel on this
// computer started its program here, so the program receives the redirect
// itself ("local"); the browser shell has no listener on the person's device
// ("unavailable"). Otherwise main listens on this device
// (src/main/loopbackRedirect.ts), checking the address again.
import { parseLoopbackRedirectUri, type PanelLoopbackRedirectResult } from "../../../shared/loopbackRedirect";
import { isBrowserShell, shellIpc } from "./shell";

export const LOOPBACK_REDIRECT_REQUEST = "paperboard:loopback-redirect";
export const LOOPBACK_REDIRECT_CANCEL = `${LOOPBACK_REDIRECT_REQUEST}-cancel`;
export const LOOPBACK_REDIRECT_RESULT = `${LOOPBACK_REDIRECT_REQUEST}-result`;
/** the shell's id for the computer it runs on */
export const LOCAL_COMPUTER_ID = "local";

export type LoopbackRedirectMessage =
    | { kind: "request"; requestId: string; redirectUri: unknown }
    | { kind: "cancel"; requestId: string };

/** routing fields only; null for anything that is not a loopback redirect message */
export function parseLoopbackRedirectMessage(data: unknown): LoopbackRedirectMessage | null {
    if (!data || typeof data !== "object") return null;
    const message = data as Record<string, unknown>;
    if (message.type !== LOOPBACK_REDIRECT_REQUEST && message.type !== LOOPBACK_REDIRECT_CANCEL) return null;
    if (typeof message.requestId !== "string" || !message.requestId || message.requestId.length > 128) return null;
    return message.type === LOOPBACK_REDIRECT_CANCEL
        ? { kind: "cancel", requestId: message.requestId }
        : { kind: "request", requestId: message.requestId, redirectUri: message.redirectUri };
}

export interface LoopbackRedirectHost {
    /** true in the browser shell, which has no listener on the person's device */
    browser: () => boolean;
    invoke: <T>(channel: string, args: unknown) => Promise<T>;
}

const shellHost: LoopbackRedirectHost = {
    browser: isBrowserShell,
    invoke: (channel, args) => shellIpc().invoke(channel, args),
};

const failed = (code: Extract<PanelLoopbackRedirectResult, { status: "failed" }>["code"], message: string): PanelLoopbackRedirectResult => ({
    status: "failed",
    code,
    message,
});

/**
 * One frame's loopback redirect: at most one open at a time. `answer` gets
 * the outcome of a request, once; `closeAll` stops the open one when the
 * frame goes away.
 */
export function createFrameLoopbackRedirects(computerId: string, host: LoopbackRedirectHost = shellHost) {
    // the panel's request id -> the shell's own id for it in main
    const open = new Map<string, string>();
    const stop = (shellId: string) =>
        host.invoke("panel-loopback-redirect-cancel", { requestId: shellId }).catch((err) => {
            console.error("[loopback] could not stop listening for a sign-in redirect:", err);
        });

    return {
        async request(requestId: string, redirectUri: unknown): Promise<PanelLoopbackRedirectResult> {
            const redirect = parseLoopbackRedirectUri(redirectUri);
            if (typeof redirect === "string") return failed("invalid-request", redirect);
            if (host.browser()) {
                return failed("unavailable", "Paperboard in a web browser cannot catch a sign-in redirect on this device. Open the Paperboard app, or paste the address the browser ended on.");
            }
            if (computerId === LOCAL_COMPUTER_ID) return { status: "local" };
            if (open.size > 0) return failed("busy", "This panel is already waiting for a sign-in redirect");
            const shellId = crypto.randomUUID();
            open.set(requestId, shellId);
            try {
                return await host.invoke<PanelLoopbackRedirectResult>("panel-loopback-redirect", { requestId: shellId, redirectUri });
            } catch (err) {
                console.error("[loopback] catching a sign-in redirect failed:", err);
                return failed("failed", err instanceof Error ? err.message : String(err));
            } finally {
                if (open.get(requestId) === shellId) open.delete(requestId);
            }
        },
        cancel(requestId: string): void {
            const shellId = open.get(requestId);
            if (shellId) void stop(shellId);
        },
        closeAll(): void {
            for (const shellId of open.values()) void stop(shellId);
        },
    };
}
