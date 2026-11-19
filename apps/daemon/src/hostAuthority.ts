import * as net from "node:net";
import * as os from "node:os";

// The listener owns this policy. Never resolve an untrusted Host through
// DNS: a rebound name would resolve to our address and defeat the check.
function authorityHostname(authority: string | undefined): string | null {
    if (!authority || /[\s/@\\?#]/.test(authority)) return null;
    try {
        const url = new URL(`http://${authority}`);
        if (url.pathname !== "/" || url.username || url.password) return null;
        return url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
    } catch {
        return null; // malformed authority is a refusal
    }
}

function loopback(host: string): boolean {
    return host === "localhost" || host.endsWith(".localhost") || host === "::1" ||
        (net.isIPv4(host) && host.startsWith("127."));
}

export function createHostAuthorityCheck(bindHost = "127.0.0.1"): (authority: string | undefined) => boolean {
    const bind = authorityHostname(bindHost.includes(":") && !bindHost.startsWith("[") ? `[${bindHost}]` : bindHost);
    // Loopback listeners accept only loopback authorities. LAN listeners
    // additionally accept the configured bind, machine/mDNS name, and IPs
    // advertised by the machine's interfaces. The set lives with the listener.
    const own = new Set<string>();
    if (bind && !loopback(bind)) {
        own.add(bind);
        const hostname = os.hostname().replace(/\.$/, "").toLowerCase();
        own.add(hostname);
        own.add(`${hostname.replace(/\.local$/, "")}.local`);
        for (const entries of Object.values(os.networkInterfaces())) {
            for (const entry of entries ?? []) {
                const ip = authorityHostname(entry.address.includes(":") ? `[${entry.address}]` : entry.address);
                if (ip) own.add(ip);
            }
        }
    }
    return authority => {
        const hostname = authorityHostname(authority);
        return hostname !== null && (loopback(hostname) || own.has(hostname));
    };
}
