// The manifest's network declaration, turned into a fetch check. The daemon
// CSP remains the enforcement boundary; this is the panel-side refusal that
// keeps a step error honest instead of a browser-level network failure.
import manifest from "../../manifest.json";

export type PanelNetworkEgress = {
    mode: "declared-hosts" | "any-https" | "closed";
    hosts: string[];
};

const MAX_HOST_LENGTH = 253;

export function parseNetworkEgress(raw: unknown): PanelNetworkEgress {
    const network = (raw as any)?.network;
    if (!network || typeof network !== "object") {
        return { mode: "closed", hosts: [] };
    }
    if (network.mode === "any-https") {
        return { mode: "any-https", hosts: [] };
    }
    const hosts: string[] = (Array.isArray(network.hosts) ? network.hosts : [])
        .filter((h: unknown): h is string => typeof h === "string")
        .map((h: string) => h.trim().toLowerCase().replace(/\.$/, ""))
        .filter((h: string) => h.length > 0 && h.length <= MAX_HOST_LENGTH);
    return { mode: hosts.length > 0 ? "declared-hosts" : "closed", hosts };
}

export const PANEL_EGRESS: PanelNetworkEgress = parseNetworkEgress(manifest);

function isLoopback(host: string): boolean {
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
}

function hostMatches(host: string, declared: string): boolean {
    return host === declared || host.endsWith(`.${declared}`);
}

/** null when allowed, otherwise the refusal sentence for the step error. */
export function egressRefusal(
    rawUrl: string,
    egress: PanelNetworkEgress = PANEL_EGRESS,
): string | null {
    let url: URL;
    try {
        url = new URL(String(rawUrl ?? ""));
    } catch (err) {
        console.debug(
            `[actions] refused a malformed fetch URL: ${String(rawUrl).slice(0, 120)}`,
            err,
        );
        return "malformed URL";
    }
    const host = url.hostname.toLowerCase();
    if (url.protocol === "http:") {
        // plain http only ever reaches this machine
        return isLoopback(host)
            ? null
            : `http is only allowed to loopback hosts, got ${host}`;
    }
    if (url.protocol !== "https:") {
        return `only https is allowed, got ${url.protocol}//${host}`;
    }
    if (egress.mode === "any-https") return null;
    if (egress.mode === "closed") {
        return "this panel declares no network access";
    }
    if (egress.hosts.some((declared) => hostMatches(host, declared))) return null;
    return `host ${host} is not in the panel's declared network hosts`;
}
