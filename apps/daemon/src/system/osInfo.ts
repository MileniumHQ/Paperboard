// What operating system this computer runs, as the shell names it
import * as os from "os";
import { execFile } from "child_process";
import { promisify } from "util";
import { getLinuxDistroInfo } from "../core/util";
import { logger } from "../core/logger";

const promisifiedExecFile = promisify(execFile);

// build number to friendly release. The reg query runs on the WS auth
// path, so the DisplayVersion result is cached per build — one entry,
// never a growing map; a sick box pays the 5s timeout at most once.
// ASYNC: the reg child never blocks the event loop (execFile, not
// execFileSync); concurrent calls share one cached promise per build.
const windowsReleaseCache = {
    build: -1,
    name: "",
    pending: null as Promise<string> | null,
};
export async function windowsReleaseName(build: number): Promise<string> {
    if (windowsReleaseCache.build === build) return windowsReleaseCache.name;
    if (!windowsReleaseCache.pending) {
        windowsReleaseCache.pending = queryWindowsReleaseName(build)
            .then((name) => {
                windowsReleaseCache.build = build;
                windowsReleaseCache.name = name;
                return name;
            })
            .finally(() => {
                windowsReleaseCache.pending = null;
            });
    }
    return windowsReleaseCache.pending;
}

async function queryWindowsReleaseName(build: number): Promise<string> {
    if (process.platform === "win32") {
        try {
            const out = await promisifiedExecFile(
                "reg",
                [
                    "query",
                    "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion",
                    "/v",
                    "DisplayVersion",
                ],
                { timeout: 5000 },
            );
            const m = /DisplayVersion\s+REG_SZ\s+(\S+)/.exec(out.stdout);
            if (m) {
                return `${build >= 22000 ? "11" : "10"} ${m[1]}`;
            }
        } catch (err) { logger.debug("[Paperboard Server] the Windows display version is unreadable; reporting the major only:", err) }
    }
    return build >= 22000 ? "11" : "10";
}

// Darwin 20-24 were macOS 11-15. Apple then moved to year numbers: Darwin 25
// is macOS 26, so from there the macOS major is Darwin + 1. Older releases
// (10.x) pass the raw Darwin release through for the shell to map.
export function macosVersionFromDarwin(release: string): string {
    const darwinMajor = parseInt(release.split(".")[0], 10);
    if (isNaN(darwinMajor) || darwinMajor < 20) return release;
    return (darwinMajor >= 25 ? darwinMajor + 1 : darwinMajor - 9).toString();
}

export async function getDetailedOsInfo(): Promise<{
    os: string;
    osVersion: string;
    distroId?: string;
    distroName?: string;
}> {
    const platform = process.platform;
    if (platform === "darwin") {
        return {
            os: "macos",
            osVersion: macosVersionFromDarwin(os.release()),
            distroId: "macos",
            distroName: "macOS",
        };
    }
    if (platform === "win32") {
        const build = parseInt(os.release().split(".")[2] || "0", 10);
        return {
            os: "windows",
            osVersion: await windowsReleaseName(build),
            distroId: "windows",
            distroName: "Windows",
        };
    }
    if (platform === "linux") {
        const info = getLinuxDistroInfo();
        return {
            os: "linux",
            osVersion: info.version || os.release(),
            distroId: info.distroId,
            distroName: info.distroName,
        };
    }
    return {
        os: process.platform,
        osVersion: os.release(),
    };
}
