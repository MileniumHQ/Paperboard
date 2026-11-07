import * as fs from "fs";
import * as path from "path";

const DOWNLOAD_BASE = "https://i.paperboard.dev/pb";

// What a Linux install that is not an AppImage needs to offer an update: the
// feed for its arch, and, for a deb or rpm Paperboard published, that package
// on the "latest" alias. electron-builder writes resources/package-type into
// the deb and rpm it builds; any other install (pacman, a distro package, an
// unpacked build) has no file of ours to download, so `download` is null.
export interface LinuxPackageInstall {
    feedUrl: string;
    download: string | null;
}

export function linuxPackageInstall(resourcesPath: string, arch: string): LinuxPackageInstall {
    if (arch !== "x64" && arch !== "arm64") throw new Error(`Paperboard is not built for Linux ${arch}`);
    const feedUrl = `${DOWNLOAD_BASE}/${arch === "arm64" ? "latest-linux-arm64.yml" : "latest-linux.yml"}`;
    let packageType: string;
    try {
        packageType = fs.readFileSync(path.join(resourcesPath, "package-type"), "utf8").trim();
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return { feedUrl, download: null };
        throw err;
    }
    const download = packageType === "deb" || packageType === "rpm"
        ? `${DOWNLOAD_BASE}/latest/paperboard-linux-${arch}.${packageType}`
        : null;
    return { feedUrl, download };
}
