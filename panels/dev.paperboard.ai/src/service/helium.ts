// The agent's browser: Helium's own portable builds, one per platform,
// downloaded into the panel's storage and checked against the hash pinned
// here. Unpacking uses what each OS ships (tar; hdiutil and ditto on macOS),
// with argv arrays only.

import fs from "node:fs";
import path from "node:path";

export const HELIUM_VERSION = "0.20.1.1";
/** the Chromium it's built on: the user agent says Chrome/<major>.0.0.0, as a desktop Chrome does */
const CHROMIUM_MAJOR = 156;

export interface HeliumBuild {
    url: string;
    sha256: string;
    kind: "tar.xz" | "dmg" | "zip";
}

const BASE = "https://github.com/imputnet";
const BUILDS: Partial<Record<string, HeliumBuild>> = {
    "linux-x64": {
        url: `${BASE}/helium-linux/releases/download/${HELIUM_VERSION}/helium-${HELIUM_VERSION}-x86_64_linux.tar.xz`,
        sha256: "2023fa44cefa0fbd3e19071c87e90d61275f08ba8f5b48d58c235215565e9b53",
        kind: "tar.xz",
    },
    "linux-arm64": {
        url: `${BASE}/helium-linux/releases/download/${HELIUM_VERSION}/helium-${HELIUM_VERSION}-arm64_linux.tar.xz`,
        sha256: "211a95e10960d62b376751920fbb93cdff051f5bfcfa136b52e970f4e6963577",
        kind: "tar.xz",
    },
    "darwin-x64": {
        url: `${BASE}/helium-macos/releases/download/${HELIUM_VERSION}/helium_${HELIUM_VERSION}_x86_64-macos.dmg`,
        sha256: "a2d5ebcc87c772fff8dea21a85e52165c68ba3118e613b3a915f4d1d33d95fba",
        kind: "dmg",
    },
    "darwin-arm64": {
        url: `${BASE}/helium-macos/releases/download/${HELIUM_VERSION}/helium_${HELIUM_VERSION}_arm64-macos.dmg`,
        sha256: "5a11718ea2237a1e59f2c84facf2166abdb80773399085d6cd7845d73f1d739a",
        kind: "dmg",
    },
    "win32-x64": {
        url: `${BASE}/helium-windows/releases/download/${HELIUM_VERSION}/helium_${HELIUM_VERSION}_x64-windows.zip`,
        sha256: "a8d84cb50a4524eff3ed00983970e7cb49e2688fbc31431445c8efc449101214",
        kind: "zip",
    },
    "win32-arm64": {
        url: `${BASE}/helium-windows/releases/download/${HELIUM_VERSION}/helium_${HELIUM_VERSION}_arm64-windows.zip`,
        sha256: "313e04c9ebd84c663c6892257e086d8984d580959107270635954a6a19c9e2bc",
        kind: "zip",
    },
};

export function heliumBuild(platform: NodeJS.Platform = process.platform, arch: string = process.arch): HeliumBuild | null {
    return BUILDS[`${platform}-${arch}`] ?? null;
}

type Exec = (command: string, args: string[], o?: { timeoutMs?: number }) => Promise<{ stdout: string; stderr: string; exitCode: number }>;

const UNPACK_MS = 5 * 60_000;

async function run(exec: Exec, command: string, args: string[], what: string) {
    const r = await exec(command, args, { timeoutMs: UNPACK_MS });
    if (r.exitCode !== 0) throw new Error(`${what} failed: ${(r.stderr || r.stdout).trim().slice(-300) || `exit ${r.exitCode}`}`);
}

/**
 * Unpack a downloaded build into `into` (which must not exist yet). It's unpacked beside it first and moved
 * into place whole, so a half-unpacked browser is never mistaken for one.
 */
export async function unpackHelium(o: { archive: string; kind: HeliumBuild["kind"]; into: string; exec: Exec; which: (c: string) => string | null }) {
    const partial = `${o.into}.partial`;
    fs.rmSync(partial, { recursive: true, force: true });
    fs.mkdirSync(partial, { recursive: true });
    try {
        if (o.kind === "dmg") {
            const hdiutil = o.which("hdiutil") ?? "/usr/bin/hdiutil";
            const ditto = o.which("ditto") ?? "/usr/bin/ditto";
            const mount = `${partial}.mount`;
            fs.mkdirSync(mount, { recursive: true });
            await run(o.exec, hdiutil, ["attach", "-nobrowse", "-readonly", "-noautoopen", "-mountpoint", mount, o.archive], "Opening the browser's disk image");
            try {
                const app = fs.readdirSync(mount).find((n) => n.endsWith(".app"));
                if (!app) throw new Error("the browser's disk image has no app in it");
                await run(o.exec, ditto, [path.join(mount, app), path.join(partial, app)], "Copying the browser");
            } finally {
                await run(o.exec, hdiutil, ["detach", mount, "-force"], "Closing the browser's disk image");
                fs.rmSync(mount, { recursive: true, force: true });
            }
        } else {
            const tar = o.which("tar") ?? (process.platform === "win32" ? path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : null);
            if (!tar) throw new Error("this computer has no tar to unpack the browser with");
            await run(o.exec, tar, [o.kind === "tar.xz" ? "-xJf" : "-xf", o.archive, "-C", partial], "Unpacking the browser");
        }
        if (!findExecutable(partial)) throw new Error("the unpacked browser has no program in it");
        fs.rmSync(o.into, { recursive: true, force: true });
        fs.renameSync(partial, o.into);
    } catch (e) {
        fs.rmSync(partial, { recursive: true, force: true });
        throw e;
    }
}

const PROGRAMS = ["helium", "helium.exe", "chrome.exe", path.join("Helium.app", "Contents", "MacOS", "Helium")];

/** The browser's program inside an unpacked build, at its top or one folder down. */
export function findExecutable(dir: string): string | null {
    const tops = [dir, ...safeList(dir).map((n) => path.join(dir, n)).filter((p) => isDir(p))];
    for (const top of tops) {
        for (const p of PROGRAMS) {
            const full = path.join(top, p);
            if (isFile(full)) return full;
        }
    }
    return null;
}

const safeList = (d: string) => {
    try {
        return fs.readdirSync(d);
    } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw e;
    }
};
const isDir = (p: string) => fs.statSync(p, { throwIfNoEntry: false })?.isDirectory() === true;
const isFile = (p: string) => fs.statSync(p, { throwIfNoEntry: false })?.isFile() === true;

/** What a desktop Chrome of the same version sends, so sites see a browser, not a headless one. */
export function userAgent(platform: NodeJS.Platform = process.platform, arch: string = process.arch): string {
    const os =
        platform === "win32"
            ? "Windows NT 10.0; Win64; x64"
            : platform === "darwin"
              ? "Macintosh; Intel Mac OS X 10_15_7"
              : arch === "arm64"
                ? "X11; Linux aarch64"
                : "X11; Linux x86_64";
    return `Mozilla/5.0 (${os}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROMIUM_MAJOR}.0.0.0 Safari/537.36`;
}
