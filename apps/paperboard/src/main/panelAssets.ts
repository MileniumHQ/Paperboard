// Local panel:// asset serving for the Electron shell. The resolver itself
// lives in papercrane/panelAssets.ts (one implementation shared with the
// daemon /panel/ route), and the document helpers live in
// shared/panelDocument.ts for every host; this module re-exports both and
// adds what needs Node: the host-name split and the nonce.
import * as crypto from "crypto";

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

export { withCspNonce, buildPanelCsp, remotePanelHtmlCsp, buildCraneCredentialPayload } from "../shared/panelDocument";
