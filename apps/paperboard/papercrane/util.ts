// small pure utilities shared by both sides
import * as os from "os";
import semver from "semver";
import { logger } from "./logger";

export interface NetworkInterfaceLike {
    address?: string;
    family?: string | number;
    internal?: boolean;
}

// an address other machines can dial. loopback and the unspecified
// address (0.0.0.0, which Windows virtual/VPN adapters report when they
// have no lease) are not connectable, so neither counts.
export function isUsableIpv4(item: NetworkInterfaceLike | undefined): boolean {
    if (!item || item.internal) return false;
    if (item.family !== "IPv4" && item.family !== 4) return false;
    const addr = item.address;
    if (!addr || addr === "0.0.0.0" || addr === "127.0.0.1") return false;
    return true;
}

function isPrivateIpv4(addr: string): boolean {
    return (
        addr.startsWith("192.168.") ||
        addr.startsWith("10.") ||
        /^172\.(1[6-9]|2[0-9]|3[01])\./.test(addr)
    );
}

// pick a reachable IPv4 from a network-interface table, preferring the
// private LAN range a peer on the same network would actually use.
export function selectNetworkIp(
    ifaces: Record<string, NetworkInterfaceLike[] | undefined>,
): string {
    let fallback = "127.0.0.1";
    for (const name of Object.keys(ifaces)) {
        const list = ifaces[name];
        if (!list) continue;
        for (const item of list) {
            if (!isUsableIpv4(item)) continue;
            const addr = item.address as string;
            if (isPrivateIpv4(addr)) return addr;
            if (fallback === "127.0.0.1") fallback = addr;
        }
    }
    return fallback;
}

export function getNetworkIp(): string {
    return selectNetworkIp(os.networkInterfaces());
}

// a bind host that names no specific interface cannot be dialed as-is
export function isUnspecifiedHost(host?: string): boolean {
    return !host || host === "0.0.0.0" || host === "::" || host === "[::]";
}

// display the address a peer can actually reach: a concrete bind host is
// shown verbatim, an unspecified bind (the default) resolves to the LAN IP.
export function getDisplayHost(host?: string): string {
    return isUnspecifiedHost(host) ? getNetworkIp() : (host as string);
}

// registry override policy: environment override is honored only outside
// production, or when an explicit --allow-registry-override flag is passed.
// one rule for the daemon and the updater — a packaged build that sets
// NODE_ENV=production cannot be redirected through ambient env.
export function resolveRegistryUrl(opts?: {
    env?: NodeJS.ProcessEnv;
    argv?: string[];
    nodeEnv?: string;
}): string {
    const env = opts?.env ?? process.env;
    const argv = opts?.argv ?? process.argv;
    const nodeEnv = opts?.nodeEnv ?? env.NODE_ENV;
    const allowOverride =
        nodeEnv !== "production" || argv.includes("--allow-registry-override");
    return allowOverride && env.ORIGAMI_REGISTRY_URL
        ? env.ORIGAMI_REGISTRY_URL
        : "https://origami.ariapis.com";
}

// race a promise against a deadline; rethrows with the original error when
// the promise wins, a typed "timeout" error when the deadline does. the
// racing timer is cleared on settle so winners don't leave pending timers.
export function withTimeout<T>(
    p: Promise<T>,
    ms: number,
    label = "operation",
): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, rej) => {
        timer = setTimeout(
            () => rej(new Error(`${label} timed out after ${ms}ms`)),
            ms,
        );
    });
    return Promise.race([p, timeout]).finally(() =>
        clearTimeout(timer as ReturnType<typeof setTimeout>),
    ) as Promise<T>;
}

// version compare with coerce, numeric fallback for garbage
export function semverGt(a: string, b: string): boolean {
    try {
        const ca = semver.coerce(a ?? "");
        const cb = semver.coerce(b ?? "");
        if (ca && cb) return semver.gt(ca, cb);
    } catch (err) { logger.debug("[util.ts] op failed:", err) }
    const parse = (v: string) =>
        (v || "")
            .replace(/^[^0-9]*/, "")
            .split(".")
            .map((n) => {
                const num = Number(n);
                return Number.isFinite(num) ? num : 0;
            });
    const [aMaj = 0, aMin = 0, aPat = 0] = parse(a);
    const [bMaj = 0, bMin = 0, bPat = 0] = parse(b);
    if (aMaj !== bMaj) return aMaj > bMaj;
    if (aMin !== bMin) return aMin > bMin;
    return aPat > bPat;
}

// bounded in-memory replay buffer, keeps the most recent output
export class RingBuffer {
    private buffer: string[] = [];
    private currentSize = 0;

    constructor(private maxSize: number = 256 * 1024) {}

    push(str: string): void {
        this.buffer.push(str);
        this.currentSize += str.length;
        while (this.currentSize > this.maxSize && this.buffer.length > 0) {
            const removed = this.buffer.shift()!;
            this.currentSize -= removed.length;
        }
    }

    getAll(): string {
        return this.buffer.join("");
    }

    get size(): number {
        return this.currentSize;
    }
}

import * as fs from "fs";

// linux distro info from /etc/os-release
export function getLinuxDistroInfo(): {
    distroId: string;
    distroName: string;
    version?: string;
} {
    if (process.platform !== "linux") {
        const plat = process.platform === "win32" ? "windows" : "macos";
        return {
            distroId: plat,
            distroName: plat === "windows" ? "Windows" : "macOS",
        };
    }
    try {
        if (fs.existsSync("/etc/os-release")) {
            const content = fs.readFileSync("/etc/os-release", "utf8");
            let id = "linux";
            let name = "Linux";
            let version: string | undefined;
            for (const line of content.split("\n")) {
                if (line.startsWith("ID="))
                    id = line.slice(3).replace(/["']/g, "").trim();
                if (line.startsWith("PRETTY_NAME="))
                    name = line.slice(12).replace(/["']/g, "").trim();
                else if (name === "Linux" && line.startsWith("NAME="))
                    name = line.slice(5).replace(/["']/g, "").trim();
                if (!version && line.startsWith("VERSION_ID=")) {
                    version = line.slice(11).replace(/["']/g, "").trim();
                }
                if (!version && line.startsWith("BUILD_ID=")) {
                    version = line.slice(9).replace(/["']/g, "").trim();
                }
            }
            const out = { distroId: id || "linux", distroName: name || "Linux" };
            return version ? { ...out, version } : out;
        }
    } catch (err) {
        console.error("[util] failed to read /etc/os-release:", err);
    }
    return { distroId: "linux", distroName: "Linux" };
}
