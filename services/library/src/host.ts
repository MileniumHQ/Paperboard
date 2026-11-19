import type { BridgeHost } from "./bridge";

/**
 * The iframe document's view of its embedder. A top-level page has no host
 * and stays standalone. `event.source === window.parent` is the one identity
 * check the child can make; this side holds no authority, so it makes no
 * origin trust decision — that belongs to the shell accepting installs.
 */
export function createWindowHost(): BridgeHost | null {
    if (typeof window === "undefined" || window.parent === window) return null;
    return {
        send(data) {
            window.parent.postMessage(data, "*");
        },
        listen(callback) {
            const receive = (event: MessageEvent) => {
                if (event.source !== window.parent) return;
                callback(event.data);
            };
            window.addEventListener("message", receive);
            return () => window.removeEventListener("message", receive);
        },
    };
}
