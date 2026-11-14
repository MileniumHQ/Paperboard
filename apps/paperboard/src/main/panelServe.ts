// Panel document serving, shared by every shell host: the Electron
// panel:// protocol handler and the browser-mode HTTP host both answer
// with servePanelAsset — one implementation of containment, credential
// injection and CSP, so the two hosts cannot drift apart.
import * as fs from "fs";
import * as path from "path";
import { STATUS_CODES } from "http";
import connectionPool, { classifyProbeError } from "./communication/papercrane/ConnectionPool";
import { logger } from "../../papercrane/logger";
import { getPanelsDir } from "../../papercrane/paths";
import { sanitizeId } from "../../papercrane/storage";
import { lookupMime } from "../../papercrane/mime";
import {
    resolveLocalPanelFile,
    buildCraneCredentialPayload,
    panelCspNonce,
    buildPanelCsp,
    remotePanelHtmlCsp,
} from "./panelAssets";
import { injectCraneBootstrap, injectCspNonce, injectMobileMode, injectUnselectable } from "../shared/panelDocument";
import { launchOptionsFromArgv } from "../shared/launchOptions";

export { parsePanelHost } from "./panelAssets";

const headerValue = (value: string | string[] | undefined): string | undefined =>
    Array.isArray(value) ? value[0] : value;

// inject computer-scoped creds; scope comes from serving URL.
// panelId travels with the credentials: identity is a granted fact,
// never parsed from a URL after the fact. The token is issued by the
// authenticated local daemon: a local panel gets its own scoped credential,
// a panel served by another computer gets a relay-only credential that can
// tunnel to that computer and touch nothing on this one. An unavailable
// issuer refuses the document rather than substituting a master token.
async function injectCraneCreds(html: string, comp: string, panelId: string): Promise<string> {
    const client = connectionPool.getClient("local");
    const granted = await client.call<{ token: string }>(
        "auth:panel-token",
        comp === "local" ? { panelId } : { panelId, relayTo: comp },
    );
    const scoped = granted?.token;
    if (typeof scoped !== "string" || !scoped) throw new Error("Paperboard Server did not issue a panel credential");
    const creds = client.getLocalCredentials();
    if (!creds) throw new Error("Paperboard Server on this computer isn't connected yet");
    return injectCraneBootstrap(html, buildCraneCredentialPayload(creds, comp, panelId, scoped));
}

// a panel document gets its credential, the phone layout flag and the CSP
// nonce, in that order, from whichever machine served its bytes
async function panelDocument(html: string, comp: string, panelId: string, nonce: string): Promise<string> {
    return injectCspNonce(
        injectMobileMode(
            injectUnselectable(await injectCraneCreds(html, comp, panelId)),
            launchOptionsFromArgv(process.argv).mobile,
        ),
        nonce,
    );
}

// the file at `file`, or null when there is none (or it went away mid-serve)
async function readLocalFile(file: string): Promise<Buffer | null> {
    try {
        if (!(await fs.promises.stat(file)).isFile()) return null;
        return await fs.promises.readFile(file);
    } catch (err: any) {
        if (err?.code === "ENOENT" || err?.code === "ENOTDIR") return null;
        throw err;
    }
}

// Not found is a missing file; anything else (an unreadable file, a refused
// credential, a computer that can't be reached) is a 500 or 502 that says why.
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

        // the URL's path names files percent-encoded ("my%20image.png"),
        // segment by segment: an encoded "/" never becomes a separator
        let segments: string[];
        try {
            segments = pathname.replace(/^\/+/, "").split("/").map(decodeURIComponent);
        } catch (err) {
            if (!(err instanceof URIError)) throw err;
            return new Response(`Invalid panel file path`, { status: 400 });
        }
        if (segments.join("") === "") segments = ["index.html"];
        const subpath = segments.join("/");

        const cleanPanelId = sanitizeId(panelId);
        if (!cleanPanelId) {
            return new Response(`Invalid panel id`, { status: 400 });
        }

        // no ACAO: panel content loads same-origin into its own panel frame.
        // Panels can update underneath a cached asset, so nothing is cached.
        const headers: Record<string, string> = {
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "no-store",
        };

        // Local machine: serve straight from the panels directory
        if (comp === "local") {
            // containment lives in panelAssets so tests prove it headless
            const resolution = resolveLocalPanelFile(getPanelsDir(), cleanPanelId, subpath);
            if (resolution.kind === "forbidden") {
                return new Response(`Forbidden`, { status: 403 });
            }
            const buffer = resolution.kind === "ok" ? await readLocalFile(resolution.file) : null;
            if (resolution.kind !== "ok" || !buffer) {
                return new Response(`Panel file not found: ${cleanPanelId}/${subpath}`, { status: 404 });
            }
            const fileExt = path.extname(resolution.file).toLowerCase();
            headers["Content-Type"] = lookupMime(fileExt);
            if (fileExt === ".html") {
                const nonce = panelCspNonce();
                headers["Content-Security-Policy"] = buildPanelCsp(nonce);
                return new Response(await panelDocument(buffer.toString("utf8"), comp, cleanPanelId, nonce), { headers });
            }
            return new Response(new Uint8Array(buffer), { headers });
        }

        const client = connectionPool.getClient(comp);
        // /panel/ is authenticated-only on the daemon: attach the same
        // main-token Bearer header the DAV surface uses
        const assetToken = client.getToken();
        let res: Awaited<ReturnType<typeof client.request>>;
        try {
            res = await client.request(`panel/${cleanPanelId}/${segments.map(encodeURIComponent).join("/")}`, {
                ...(assetToken ? { headers: { Authorization: `Bearer ${assetToken}` } } : {}),
            });
        } catch (err) {
            // an unreachable or mis-pinned computer is not a missing file
            const name = connectionPool.getComputer(comp)?.name ?? comp;
            logger.warn(`[PanelProtocol] ${name} did not serve ${cleanPanelId}/${subpath}:`, err);
            return new Response(`${name} could not be reached: ${classifyProbeError(err)}`, { status: 502 });
        }
        if (!res.ok) {
            return new Response(STATUS_CODES[res.status] ?? "Error", { status: res.status });
        }
        const buffer = new Uint8Array(res.body);
        const ext = path.extname(subpath).toLowerCase();
        headers["Content-Type"] = headerValue(res.headers["content-type"]) || lookupMime(ext);
        if (ext === ".html") {
            // CSP comes from the machine that serves the panel: the
            // daemon derived it from the manifest IT installed and
            // review approved. Deriving egress from the local manifest
            // would give a remote panel the wrong machine's policy.
            const served = headerValue(res.headers["content-security-policy"]) ?? null;
            const nonce = panelCspNonce();
            headers["Content-Security-Policy"] = remotePanelHtmlCsp(served, nonce);
            return new Response(await panelDocument(new TextDecoder().decode(buffer), comp, cleanPanelId, nonce), { headers });
        }
        return new Response(buffer, { headers });
    } catch (err: any) {
        logger.error("[PanelProtocol] error:", err?.message || err);
        return new Response(`Error: ${err?.message || err}`, { status: 500 });
    }
}
