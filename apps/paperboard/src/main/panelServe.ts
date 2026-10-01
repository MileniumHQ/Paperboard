// Panel document serving, shared by every shell host: the Electron
// panel:// protocol handler and the browser-mode HTTP host both answer
// with servePanelAsset — one implementation of containment, credential
// injection and CSP, so the two hosts cannot drift apart.
import * as fs from "fs";
import * as path from "path";
import { STATUS_CODES } from "http";
import connectionPool from "./communication/papercrane/ConnectionPool";
import { logger } from "../../papercrane/logger";
import { getPanelsDir } from "../../papercrane/paths";
import { readCraneHandshake } from "../../papercrane/handshake";
import { sanitizeId } from "../../papercrane/storage";
import { lookupMime } from "../../papercrane/mime";
import {
    resolveLocalPanelFile,
    buildCraneCredentialPayload,
    PANEL_CSP_NONCE,
    buildPanelCsp,
    remotePanelHtmlCsp,
} from "./panelAssets";

export { parsePanelHost } from "./panelAssets";

const log = logger;

const headerValue = (value: string | string[] | undefined): string | undefined =>
    Array.isArray(value) ? value[0] : value;

const injectCspNonce = (html: string) =>
    html.replaceAll("<script", `<script nonce="${PANEL_CSP_NONCE}"`);

// panels render outside shell styles; keep the same no-select baseline
const injectUnselectable = (html: string): string => {
    const style = `<style>html{-webkit-user-select:none;user-select:none}input,textarea,select,[contenteditable="true"],[contenteditable=""]{-webkit-user-select:text;user-select:text}code,pre,kbd,samp,[data-selectable="true"]{-webkit-user-select:text;user-select:text}</style>`;
    if (/<head[^>]*>/i.test(html)) {
        return html.replace(/<head[^>]*>/i, (m) => `${m}${style}`);
    }
    return `${style}${html}`;
};

// inject computer-scoped creds; scope comes from serving URL.
// panelId travels with the credentials: identity is a granted fact,
// never parsed from a URL after the fact. The token is the panel's own
// scoped credential issued by the authenticated local daemon. An unavailable
// issuer refuses the document rather than substituting a master token.
const injectCraneCreds = async (
    html: string,
    comp: string,
    panelId?: string,
): Promise<string> => {
    const creds = readCraneHandshake();
    if (!panelId) throw new Error("Panel credential injection requires an explicit panel id");
    const granted = await connectionPool.getClient("local").call<{ token: string }>("auth:panel-token", { panelId });
    const scoped = granted?.token;
    if (typeof scoped !== "string" || !scoped) throw new Error("Daemon did not issue a panel credential");
    const payload = buildCraneCredentialPayload(creds, comp, panelId, scoped);
    const bootstrap = `<script>window.__PAPERBOARD_CRANE=${payload};</script>`;
    if (/<head[^>]*>/i.test(html)) {
        return html.replace(/<head[^>]*>/i, (m) => `${m}${bootstrap}`);
    }
    // no <head> — prepend; scripts run before body anyway
    return `${bootstrap}${html}`;
};

export async function servePanelAsset(
    urlComp: string,
    panelId: string,
    pathname: string,
): Promise<Response> {
    try {
        // deliberately no fallback to active computer
        const comp = urlComp === "local" || connectionPool.getComputer(urlComp) ? urlComp : null;
        if (!comp) {
            return new Response(`Unknown computer: ${urlComp}`, {
                status: 404,
            });
        }

        let subpath = pathname.replace(/^\/+/, "");
        if (!subpath) subpath = "index.html";

        const cleanPanelId = sanitizeId(panelId);
        if (!cleanPanelId) {
            return new Response(`Invalid panel id`, { status: 400 });
        }

        // Local machine: serve straight from the panels directory
        if (comp === "local") {
            // containment lives in panelAssets so tests prove it headless
            const resolution = resolveLocalPanelFile(
                getPanelsDir(),
                cleanPanelId,
                subpath,
            );
            if (resolution.kind === "forbidden") {
                return new Response(`Forbidden`, { status: 403 });
            }
            if (resolution.kind === "ok") {
                const targetFile: string = resolution.file;
                try {
                    if (fs.statSync(targetFile).isFile()) {
                        const buffer = await fs.promises.readFile(targetFile);
                        const ext = path.extname(targetFile).toLowerCase();
                        const headers: Record<string, string> = {
                            "Content-Type": lookupMime(ext),
                            "X-Content-Type-Options": "nosniff",
                            // no ACAO: panel content loads same-origin
                            // into its own panel frame
                            "Cache-Control": "no-store",
                        };
                        if (ext === ".html") {
                            headers["Content-Security-Policy"] =
                                buildPanelCsp(cleanPanelId);
                            const html = injectCspNonce(
                                injectUnselectable(
                                    await injectCraneCreds(
                                        buffer.toString("utf8"),
                                        comp,
                                        cleanPanelId,
                                    ),
                                ),
                            );
                            return new Response(html, { headers });
                        }
                        return new Response(buffer, { headers });
                    }
                } catch (err) {
                    // lost race with deletion — fall through to 404
                    log.debug("[PanelProtocol] panel asset vanished mid-serve:", String(err));
                }
            }
            return new Response(
                `Panel file not found: ${cleanPanelId}/${subpath}`,
                { status: 404 },
            );
        }

        const client = connectionPool.getClient(comp);
        // /panel/ is authenticated-only on the daemon: attach the same
        // main-token Bearer header the DAV surface uses
        const assetToken = client.getToken();
        const res = await client.request(`panel/${cleanPanelId}/${subpath}`, {
            ...(assetToken ? { headers: { Authorization: `Bearer ${assetToken}` } } : {}),
        }).catch((err) => {
            log.debug("[PanelProtocol] asset fetch failed:", err?.message || err);
            return null;
        });
        if (!res || !res.ok) {
            return new Response(res ? STATUS_CODES[res.status] ?? "Error" : "Not Found", {
                status: res ? res.status : 404,
            });
        }
        const buffer = new Uint8Array(res.body);
        const remoteExt = path.extname(subpath).toLowerCase();
        const contentType =
            headerValue(res.headers["content-type"]) || lookupMime(remoteExt);
        const headers: Record<string, string> = {
            "Content-Type": contentType,
            "X-Content-Type-Options": "nosniff",
            // no ACAO: panel content loads same-origin into its own panel
            // frame; the remote /panel/ route is Bearer-authenticated too.
            // Parity with the local branch: panels can update underneath
            // a cached remote asset, so nothing here may be cached
            "Cache-Control": "no-store",
        };
        let responseBody: BodyInit = buffer;
        if (remoteExt === ".html") {
            // CSP comes from the machine that serves the panel: the
            // daemon derived it from the manifest IT installed and
            // review approved. Deriving egress from the local manifest
            // would give a remote panel the wrong machine's policy.
            const served = headerValue(res.headers["content-security-policy"]) ?? null;
            headers["Content-Security-Policy"] = remotePanelHtmlCsp(served);
            responseBody = injectCspNonce(
                injectUnselectable(
                    await injectCraneCreds(
                        new TextDecoder().decode(buffer),
                        comp,
                        cleanPanelId,
                    ),
                ),
            );
        }

        return new Response(responseBody, { headers });
    } catch (err: any) {
        log.error("[PanelProtocol] error:", err?.message || err);
        return new Response(`Error: ${err?.message || err}`, { status: 500 });
    }
}
