// The agent's browser: Helium, as the daemon's `helium` package. Origami's
// record points at imputnet's own builds, and the daemon checks each one and
// unpacks it on this computer by the record's recipe (a dmg on macOS), into
// <package>/bin. Updates come the same way: the daemon holds one back while
// the browser runs from the installed build.

import fs from "node:fs";
import path from "node:path";

export const HELIUM_PACKAGE = "helium";

/** the platforms Helium builds for, as the package record names them */
export function heliumSupported(platform: NodeJS.Platform = process.platform, arch: string = process.arch): boolean {
    return ["linux", "darwin", "win32"].includes(platform) && ["x64", "arm64"].includes(arch);
}

const PROGRAMS = ["helium", "chrome.exe", path.join("Helium.app", "Contents", "MacOS", "Helium")];

/** The browser's program in the package's bin/: where each platform's recipe puts it. */
export function findExecutable(bin: string): string | null {
    for (const p of PROGRAMS) {
        const full = path.join(bin, p);
        if (fs.statSync(full, { throwIfNoEntry: false })?.isFile()) return full;
    }
    return null;
}

/** The Chromium major in Browser.getVersion's product ("HeadlessChrome/156.0.8078.47"). */
export function chromiumMajor(product: unknown): number {
    const m = typeof product === "string" ? /^[A-Za-z]*Chrom[a-z]*\/(\d+)\./.exec(product) : null;
    if (!m) throw new Error(`The browser reported a version that isn't Chromium's: ${JSON.stringify(product)}`);
    return Number(m[1]);
}

/** What a desktop Chrome of the same version sends, so sites see a browser, not a headless one. */
export function userAgent(major: number, platform: NodeJS.Platform = process.platform, arch: string = process.arch): string {
    const os =
        platform === "win32"
            ? "Windows NT 10.0; Win64; x64"
            : platform === "darwin"
              ? "Macintosh; Intel Mac OS X 10_15_7"
              : arch === "arm64"
                ? "X11; Linux aarch64"
                : "X11; Linux x86_64";
    return `Mozilla/5.0 (${os}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
}
