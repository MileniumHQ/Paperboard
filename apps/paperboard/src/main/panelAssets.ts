// Local panel:// asset serving for the Electron shell. The resolver itself
// lives in papercrane/panelAssets.ts (one implementation shared with the
// daemon /panel/ route); this module re-exports it and adds the
// Electron-side iframe credential payload builder.
import * as crypto from "crypto";
import { buildPanelCsp as localEgressCsp } from "../../papercrane/panelNet";

export {
    resolveLocalPanelFile,
    type PanelAssetResolution,
    PANEL_TRAVERSAL_VECTORS,
} from "../../papercrane/panelAssets";

// panel://<computerId>.<panelId>/<path> — scope is part of the origin.
// Browser mode puts the same "<computerId>.<panelId>" prefix in front of its
// host suffix, so both hosts split it here.
export function parsePanelHost(
    hostname: string,
): { comp: string; panelId: string } | null {
    const dot = hostname.indexOf(".");
    if (dot <= 0) return null;
    return { comp: hostname.slice(0, dot), panelId: hostname.slice(dot + 1) };
}

// fresh nonce for panel script tags, one per HTML response: a nonce that
// outlives its document lets any later panel content reuse it. Generated
// in the shell process and never persisted.
export function panelCspNonce(): string {
    return crypto.randomBytes(16).toString("base64");
}

// add the script nonce to any CSP — a daemon-built CSP gets the same
// treatment as a locally-built one
export const withCspNonce = (csp: string, nonce: string) =>
    csp.replace(/script-src(?!-)/, (m) => `${m} 'nonce-${nonce}'`);

// CSP for a locally-served panel: egress facts come from the local manifest
export const buildPanelCsp = (panelId: string | undefined, nonce: string) =>
    withCspNonce(localEgressCsp(panelId), nonce);

// CSP for a REMOTELY-served panel HTML response: the egress facts must be
// the serving daemon's (it holds the manifest that was reviewed and
// installed on that machine). The local manifest is never consulted here —
// if the peer sends no CSP (protocol mismatch), the panel gets a closed
// policy, not the wrong machine's declarations. `frame-ancestors` is
// STRIPPED: the daemon's copy says "nobody may embed this" because TopBar
// windows point at nothing — but in the shell the panel document IS the
// iframe content, and importing that directive would block the very
// embedding the shell performs.
export const remotePanelHtmlCsp = (servedCsp: string | null | undefined, nonce: string): string => {
    if (servedCsp && servedCsp.includes("script-src")) {
        return withCspNonce(
            servedCsp
                .replace(/frame-ancestors\s+[^;]+;?\s*/g, "")
                .trim(),
            nonce,
        );
    }
    return localEgressCsp();
};

export interface CraneCreds {
    port: number;
    token: string;
}

// Credential payload for panel iframes: issuance failure refuses bootstrap.
// A master token is never substituted. The panelId travels WITH the credential —
// identity is a granted fact, never parsed from a URL after the fact.
//
// The payload lands inside a <script> block in served HTML, so `<` is
// escaped: today every field is URL/hostname/token-shaped and cannot break
// out, but a tampered crane.json (see readCraneCreds) must not become a
// script breakout either.
export function buildCraneCredentialPayload(
    creds: CraneCreds | null,
    computerId: string,
    panelId: string | undefined,
    scopedToken: string,
): string {
    if (!creds || !scopedToken) return "null";
    return JSON.stringify({
        ...creds,
        token: scopedToken,
        scoped: Boolean(scopedToken),
        computerId,
        panelId: panelId || "",
    }).replace(/</g, "\\u003c");
}
