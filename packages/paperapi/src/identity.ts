// Panel and computer identity parsing, consolidated in one place.
// TODO(remove after v3.1): the hostname-derived fallbacks in this file die
// with the scoped-token milestone. Explicit identity (transport computerId,
// injected panelId, service boot context) is non-negotiable; these parsers
// only exist for the panel:// URL scheme and the Electron shim surface.

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

// Computer scope implied by the hostname prefix of the embedding document
// (panel://host scope). TODO(remove after v3.1): the panel:// URL scheme
// itself is replaced by explicit transports; re-verify before removal
export function ambientScope(): string {
    if (typeof location !== "undefined") {
        const host = location.hostname || "";
        const dot = host.indexOf(".");
        if (dot > 0) return host.slice(0, dot);
    }
    return "local";
}

// Panel id implied by the hostname suffix of the embedding document
// (panel://host/panel or panel://panel.host scopes the panel, not the
// computer). TODO(remove after v3.1): dies with the panel:// URL scheme
function panelIdFromHostname(): string {
    if (typeof window === "undefined" || !window.location) return "";
    const host = window.location.hostname || "";
    const dot = host.indexOf(".");
    return dot < 0 ? host : host.slice(dot + 1);
}

// Resolves the acting panel id, in priority order (matches the original
// parser semantics exactly):
// 1. explicitly injected panel id (host/provider identity — authoritative)
// 2. hostname parsing — deprecated ambient fallback, warned once, removed
//    after v3.1 (the injected id is already first, so this is a leaf path)
// 3. the service boot context captured at service start (in-process boot
//    window or spawned-service env — see boot.ts). Identity is granted at
//    start, never read ambiently: no code path reads process.env here.
export function resolvePanelId(): string {
    if (typeof window !== "undefined" && window.location) {
        const injected = (globalThis as any).__PAPERBOARD_CRANE?.panelId;
        if (injected) return injected;
        const fallback = panelIdFromHostname();
        if (fallback) {
            warnOnce(
                "hostname-fallback",
                `[paperapi] panel id resolved from URL hostname (${fallback}) — host should inject an explicit panelId`,
            );
        }
        return fallback;
    }
    return serviceBootContext()?.panelId ?? "";
}

// Transport-level default panel id; opts.panelId is the transport's own
// explicit identity and wins over the ambient fallbacks.
export function resolveDefaultPanelId(optsPanelId: string | undefined): string {
    if (optsPanelId) return optsPanelId;
    return resolvePanelId();
}