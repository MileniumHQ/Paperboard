// Identity comes from host injection, service boot, or explicit transport
// options. A document URL is an asset address, never a credential claim.

import { serviceBootContext } from "./boot";
import { requirePanelId } from "./panelIdentity";

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

// Address of an asset served from another panel's origin on the same
// computer (a sibling's icon in a picker, say). Electron serves every panel
// from panel://<computerId>.<panelId>/; browser mode serves it from
// http://<computerId>.<panelId>.<shell host>/. The shape follows the
// document this runs in; the computer is the granted one, never assumed.
export function panelAssetUrl(panelId: string, subpath = ""): string {
    const target = requirePanelId(panelId);
    const computerId = grantedComputerId();
    const rest = subpath.replace(/^\.?\/+/, "");
    const own = resolvePanelId();
    const loc = (globalThis as any).location as Location | undefined;
    if (own && loc && (loc.protocol === "http:" || loc.protocol === "https:")) {
        const prefix = `${computerId}.${own}.`;
        if (loc.host.startsWith(prefix)) {
            return `${loc.protocol}//${computerId}.${target}.${loc.host.slice(prefix.length)}/${rest}`;
        }
    }
    return `panel://${computerId}.${target}/${rest}`;
}
