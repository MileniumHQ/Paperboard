// small pure utilities shared by both sides
import semver from "semver";
import { logger } from "./logger";

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
