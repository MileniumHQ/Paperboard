// small utilities shared by both sides
import * as dgram from "dgram";
import * as os from "os";

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

// pick the IPv4 another machine on this network should dial. The address
// the default route leaves from is the one peers reach; container and VM
// bridges (Podman's 10.88.0.1, Docker's 172.17.0.1, WSL's vEthernet) are
// private too, so "the first private address" can name one of them. With no
// default route, the first private address is still the best guess.
export function selectNetworkIp(
    ifaces: Record<string, NetworkInterfaceLike[] | undefined>,
    routed: string | null = null,
): string {
    const usable = Object.values(ifaces).flatMap((list) => (list ?? []).filter(isUsableIpv4)).map((item) => item.address as string);
    if (routed !== null && usable.includes(routed)) return routed;
    return usable.find(isPrivateIpv4) ?? usable[0] ?? "127.0.0.1";
}

// TEST-NET-1 (RFC 5737): routed like any outside address, owned by no one.
// Connecting a UDP socket sends nothing; the kernel only picks the route,
// and with it the source address of the interface that carries it.
const ROUTE_PROBE = "192.0.2.1";

/** The local IPv4 the default route leaves from, or null when there is no default route. */
export function defaultRouteIpv4(): Promise<string | null> {
    return new Promise((resolve) => {
        const socket = dgram.createSocket("udp4");
        let answered = false;
        const answer = (ip: string | null) => {
            if (answered) return;
            answered = true;
            socket.close();
            resolve(ip);
        };
        // a UDP connect sends nothing, so it fails only when no route exists
        // (Node says ENETUNREACH, Bun a bare "Failed to connect socket")
        socket.once("error", () => answer(null));
        socket.connect(9, ROUTE_PROBE, (err?: Error) => answer(err ? null : socket.address().address));
    });
}

export async function getNetworkIp(): Promise<string> {
    return selectNetworkIp(os.networkInterfaces(), await defaultRouteIpv4());
}

// a bind host that names no specific interface cannot be dialed as-is
export function isUnspecifiedHost(host?: string): boolean {
    return !host || host === "0.0.0.0" || host === "::" || host === "[::]";
}

// display the address a peer can actually reach: a concrete bind host is
// shown verbatim, an unspecified bind (the default) resolves to the LAN IP.
export async function getDisplayHost(host?: string): Promise<string> {
    return isUnspecifiedHost(host) ? await getNetworkIp() : (host as string);
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
import { logger } from "./logger";

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
        // shown as plain Linux; the log keeps why
        logger.warn("[util] /etc/os-release is unreadable, so this computer shows as Linux:", err);
    }
    return { distroId: "linux", distroName: "Linux" };
}

// the shell a terminal runs when its creator named none
export function getDefaultShell(): string {
    if (process.platform === "win32") {
        return process.env.COMSPEC || "powershell.exe";
    }
    if (process.platform === "darwin") {
        if (fs.existsSync("/bin/zsh")) return "/bin/zsh";
        if (fs.existsSync("/bin/bash")) return "/bin/bash";
        return "/bin/sh";
    }
    if (process.env.SHELL && fs.existsSync(process.env.SHELL)) {
        return process.env.SHELL;
    }
    if (fs.existsSync("/bin/bash")) return "/bin/bash";
    if (fs.existsSync("/usr/bin/bash")) return "/usr/bin/bash";
    return "/bin/sh";
}
