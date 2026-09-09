// small pure utilities shared by both sides
import semver from "semver";

// version compare with coerce, numeric fallback for garbage
export function semverGt(a: string, b: string): boolean {
    try {
        const ca = semver.coerce(a ?? "");
        const cb = semver.coerce(b ?? "");
        if (ca && cb) return semver.gt(ca, cb);
    } catch {}
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
export function getLinuxDistroInfo(): { distroId: string; distroName: string } {
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
            for (const line of content.split("\n")) {
                if (line.startsWith("ID="))
                    id = line.slice(3).replace(/["']/g, "").trim();
                if (line.startsWith("PRETTY_NAME="))
                    name = line.slice(12).replace(/["']/g, "").trim();
                else if (name === "Linux" && line.startsWith("NAME="))
                    name = line.slice(5).replace(/["']/g, "").trim();
            }
            return { distroId: id || "linux", distroName: name || "Linux" };
        }
    } catch {}
    return { distroId: "linux", distroName: "Linux" };
}
