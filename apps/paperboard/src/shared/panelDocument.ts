// How a shell host turns a panel's HTML into the document its frame loads:
// the panel's credential, a per-response script nonce, the CSP and the
// no-select baseline. Pure string work with no Node or Electron imports, so
// every host (Electron, browser mode, Paperboard web's Worker) shares it.
import { buildPanelCsp as fixedPanelCsp } from "../../papercrane/panelNet";

// add the script nonce to any CSP — a daemon-built CSP gets the same
// treatment as a locally-built one
export const withCspNonce = (csp: string, nonce: string) =>
    csp.replace(/script-src(?!-)/, (m) => `${m} 'nonce-${nonce}'`);

// CSP for a locally-served panel: the one fixed panel policy
export const buildPanelCsp = (nonce: string) =>
    withCspNonce(fixedPanelCsp(), nonce);

// CSP for a REMOTELY-served panel HTML response: the serving daemon's
// policy wins when it sends one (a protocol-mismatched peer falls back to
// the same fixed panel policy the shell uses locally). `frame-ancestors` is
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
    return fixedPanelCsp();
};

export const injectCspNonce = (html: string, nonce: string) =>
    html.replaceAll("<script", `<script nonce="${nonce}"`);

// panels render outside shell styles; keep the same no-select baseline
export const injectUnselectable = (html: string): string => {
    const style = `<style>html{-webkit-user-select:none;user-select:none}input,textarea,select,[contenteditable="true"],[contenteditable=""]{-webkit-user-select:text;user-select:text}code,pre,kbd,samp,[data-selectable="true"]{-webkit-user-select:text;user-select:text}</style>`;
    if (/<head[^>]*>/i.test(html)) {
        return html.replace(/<head[^>]*>/i, (m) => `${m}${style}`);
    }
    return `${style}${html}`;
};

/** the daemon a panel's credential is for: a loopback port, or a URL */
export type PanelCraneEndpoint = { port: number; url?: undefined } | { url: string; port?: undefined };

// Credential payload for panel iframes: issuance failure refuses bootstrap.
// A master token is never substituted. The panelId travels WITH the credential —
// identity is a granted fact, never parsed from a URL after the fact.
//
// The payload lands inside a <script> block in served HTML, so `<` is
// escaped so credential data cannot become executable HTML markup.
export function buildCraneCredentialPayload(
    creds: (PanelCraneEndpoint & { token?: string }) | null,
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

// the credential runs before any of the panel's own scripts
export function injectCraneBootstrap(html: string, payload: string): string {
    const bootstrap = `<script>window.__PAPERBOARD_CRANE=${payload};</script>`;
    if (/<head[^>]*>/i.test(html)) {
        return html.replace(/<head[^>]*>/i, (m) => `${m}${bootstrap}`);
    }
    // no <head> — prepend; scripts run before body anyway
    return `${bootstrap}${html}`;
}
