// Identity comes from host injection, service boot, or explicit transport
// options. A document URL is an asset address, never a credential claim.

import { serviceBootContext } from "./boot";

// log-once ledger. BOUNDED: an append-only array grows with every distinct
// label a long-lived process warns about, so past the cap the oldest entry
// drops (the label may then warn again — verbosity is preferred to a leak)
const warnedCaps: string[] = [];
const MAX_WARNED_CAPS = 32;

export function warnOnce(labels: string, ...args: unknown[]): void {
    if (warnedCaps.includes(labels)) return;
    if (warnedCaps.length >= MAX_WARNED_CAPS) warnedCaps.shift();
    warnedCaps.push(labels);
    console.warn(...args);
}

export function grantedComputerId(): string {
    const computerId = (globalThis as any).__PAPERBOARD_CRANE?.computerId;
    if (typeof computerId === "string" && computerId) return computerId;
    // Services and explicitly initialized shell transports connect locally.
    if (typeof window !== "undefined" && !serviceBootContext()) {
        throw new Error("Paperboard computer identity was not injected; initialize an explicit transport");
    }
    return "local";
}

export function resolvePanelId(): string {
    if (typeof window !== "undefined") {
        const injected = (globalThis as any).__PAPERBOARD_CRANE?.panelId;
        return typeof injected === "string" ? injected : "";
    }
    return serviceBootContext()?.panelId ?? "";
}

// Transport-level default panel id; opts.panelId is the transport's own
// explicit identity and wins over a granted boot identity.
export function resolveDefaultPanelId(optsPanelId: string | undefined): string {
    if (optsPanelId) return optsPanelId;
    return resolvePanelId();
}
