import * as fs from "fs";
import * as path from "path";
import { DOWNLOAD_BASE } from "./linuxPackageInstall";

// Paperboard's installer writes "Uninstall Paperboard.exe" beside the app; the
// MSI, which an administrator deploys and versions, does not. electron-updater
// can only replace an installer install, and would put a second, per-user
// copy beside an MSI one, so an install without the uninstaller is offered
// the new MSI as a download instead.
export interface WindowsMsiInstall {
    feedUrl: string;
    download: string;
}

export function windowsMsiInstall(installDir: string, arch: string): WindowsMsiInstall | null {
    if (fs.existsSync(path.join(installDir, "Uninstall Paperboard.exe"))) return null;
    if (arch !== "x64") throw new Error(`Paperboard is not built for Windows ${arch}`);
    return { feedUrl: `${DOWNLOAD_BASE}/latest.yml`, download: `${DOWNLOAD_BASE}/latest/paperboard-windows-x64.msi` };
}
