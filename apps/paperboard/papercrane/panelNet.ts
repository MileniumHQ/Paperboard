import * as fs from "fs";
import * as path from "path";
import { getPaperboardDir } from "./paths";
import { logger } from "./logger";

// per-panel network egress is a declared fact in the panel manifest:
//
//   "network": { "hosts": ["api.modrinth.com"], "mode": "any-https" }
//
// review sees what a panel is allowed to talk to; the panel CSP is built
// from this. UI-layer fetches to unknown hosts are refused by the browser;
// service-side (node) fetches stay governed by review against the panel's
// stated product.

const HOST_RE = /^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$/;
const MAX_HOSTS = 32;
const MAX_HOST_LENGTH = 128;

export interface PanelNetworkEgress {
    mode: "declared-hosts" | "any-https" | "closed";
    hosts: string[];
}

export function parseNetworkEgress(manifest: unknown): PanelNetworkEgress {
    const network = (manifest as any)?.network;
    if (!network || typeof network !== "object") {
        return { mode: "closed", hosts: [] };
    }
    if (network.mode === "any-https") {
        return { mode: "any-https", hosts: [] };
    }
    const rawHosts = Array.isArray(network.hosts) ? network.hosts : [];
    const hosts: string[] = [];
    for (const h of rawHosts) {
        if (typeof h === "string" && h.length <= MAX_HOST_LENGTH && HOST_RE.test(h)) {
            // scheme-relative: https + wss only, never loose
            hosts.push(h);
        } else {
            logger.warn(`[panel-net] ignoring invalid network host entry: ${JSON.stringify(h)}`);
        }
        if (hosts.length >= MAX_HOSTS) {
            logger.warn("[panel-net] network hosts list truncated at cap");
            break;
        }
    }
    return { mode: hosts.length > 0 ? "declared-hosts" : "closed", hosts };
}

export function panelCspForEgress(egress: PanelNetworkEgress): string {
    const connect = ["'self'", "panel:", "ws://127.0.0.1:*", "ws://localhost:*", "http://127.0.0.1:*", "http://localhost:*"];
    // declared hosts are usable for images too — the manifest lists hosts the
    // panel may talk to, and avatars/thumbnails are part of that story. closed
    // mode stays closed: zero remote image beacons.
    // panel: and *.paperboard.localhost are the same thing in two hosts:
    // sibling panel origins (Electron and browser mode, loopback-only)
    const img = ["'self'", "panel:", "http://*.paperboard.localhost:*", "data:", "blob:"];
    if (egress.mode === "any-https") {
        connect.push("https:");
        img.push("https:");
    } else {
        connect.push(...egress.hosts.map((h) => `https://${h}`));
        img.push(...egress.hosts.map((h) => `https://${h}`));
    }
    return [
        "default-src 'self' panel: data: blob:",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        `img-src ${img.join(" ")}`,
        "font-src 'self' data:",
        `connect-src ${connect.join(" ")}`,
        "media-src 'self' panel: blob:",
    ].join("; ");
}

export function buildPanelCsp(panelId?: string): string {
    if (!panelId) return panelCspForEgress({ mode: "closed", hosts: [] });
    try {
        const manifestPath = path.join(getPaperboardDir(), "panels", panelId, "manifest.json");
        if (fs.existsSync(manifestPath)) {
            const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
            return panelCspForEgress(parseNetworkEgress(manifest));
        }
    } catch (err) {
        logger.debug(`[panel-net] CSP egress lookup failed for ${panelId}:`, err);
    }
    return panelCspForEgress({ mode: "closed", hosts: [] });
}
