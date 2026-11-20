// Paperboard's own update: electron-updater where it can replace the app
// (AppImage, macOS, Windows installer), Paperboard's deb or rpm where this
// computer can install one itself, and otherwise a notice with where to
// download it (another package manager), or for an MSI install, that its
// administrator updates it.
// One AppUpdateSession owns the state every window shows.
import * as path from "path";
import { app, autoUpdater as electronAutoUpdater } from "electron";
import type { AppUpdater } from "electron-updater";
import { AppUpdateSession, getAppUpdateState, retainAppUpdateState } from "./appUpdateSession";
import { ManualAppUpdater } from "./manualAppUpdater";
import { DOWNLOAD_BASE } from "./downloadBase";
import { linuxPackageInstall } from "./linuxPackageInstall";
import { LinuxPackageUpdater, onPath } from "./linuxPackageUpdater";
import { windowsMsiInstall } from "./windowsPackageInstall";
import { createPlatformUpdater } from "./platformUpdater";
import { electronDataDir } from "./electronData";
import { pushToShells } from "./communication/shellPush";
import { updateQueue } from "./updateQueue";
import { TASK_TIMEOUT_MS } from "./updateTasks";
import { agreeToQuit, confirmQuit } from "./quitGate";
import { getLogger, logger } from "daemon/core/logger";
import type { AppUpdateState } from "../shared/appUpdate";
import type { UpdateItem } from "../shared/updateQueue";

const appUpdaterLog = getLogger("electron-updater");

let autoUpdater: AppUpdater | null = null;
// a deb or rpm Paperboard published, on a machine that can install it itself
let packageUpdater: LinuxPackageUpdater | null = null;
let session: AppUpdateSession | null = null;

// a deb or rpm install says which; an AppImage or another OS has none
let install: ReturnType<typeof linuxPackageInstall> | null | undefined;
function linuxInstall(): ReturnType<typeof linuxPackageInstall> | null {
    if (install === undefined) {
        install = process.platform === "linux" && !process.env.APPIMAGE
            ? linuxPackageInstall(process.resourcesPath, process.arch)
            : null;
    }
    return install;
}

// downloads go to <PAPERBOARD_DIR>/local/electron/paperboard-updater
function platformUpdater(): AppUpdater {
    const updater = createPlatformUpdater(electronDataDir());
    updater.logger = {
        info: (msg: string) => appUpdaterLog.info(String(msg)),
        warn: (msg: string) => appUpdaterLog.warn(String(msg)),
        error: (msg: string) => appUpdaterLog.error(String(msg)),
        debug: (msg: string) => appUpdaterLog.debug(String(msg)),
    } as any;
    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = true;
    // the install started (Restart to update already asked the pages): quit
    // without asking again. An install that refuses never says this, so a
    // later quit still asks.
    electronAutoUpdater.on("before-quit-for-update", agreeToQuit);
    autoUpdater = updater;
    return updater;
}

// an MSI install says so by having no uninstaller; any other OS has none
let msi: ReturnType<typeof windowsMsiInstall> | undefined;
function windowsInstall(): ReturnType<typeof windowsMsiInstall> {
    if (msi === undefined) {
        msi = process.platform === "win32" && app.isPackaged
            ? windowsMsiInstall(path.dirname(process.execPath), process.arch)
            : null;
    }
    return msi;
}

/** The app's update session, made on first use. */
export function appUpdater(): AppUpdateSession {
    if (session) return session;
    const fromMsi = windowsInstall();
    if (fromMsi) {
        return startSession(new ManualAppUpdater(app.getVersion(), fromMsi.feedUrl), "administrator");
    }
    const found = linuxInstall();
    if (found?.packageType) {
        const candidate = new LinuxPackageUpdater({
            currentVersion: app.getVersion(),
            feedUrl: found.feedUrl,
            downloadBase: DOWNLOAD_BASE,
            file: path.basename(new URL(found.download!).pathname),
            type: found.packageType,
            downloadDir: path.join(electronDataDir(), "paperboard-package-updater"),
            which: (cmd) => onPath(cmd),
        });
        // without pkexec or the package tool, the person installs it themselves
        if (candidate.canInstall) packageUpdater = candidate;
        else logger.info(`[Updater] this computer can't install a .${found.packageType} itself; updates are offered as a download`);
    }
    const updater = packageUpdater ?? (found ? new ManualAppUpdater(app.getVersion(), found.feedUrl) : platformUpdater());
    const mode: AppUpdateState["installMode"] = !found || packageUpdater ? "automatic" : found.download ? "package-download" : "package-manager";
    return startSession(updater, mode);
}

function startSession(updater: ConstructorParameters<typeof AppUpdateSession>[0], mode: AppUpdateState["installMode"]): AppUpdateSession {
    session = new AppUpdateSession(updater, (state) => {
        retainAppUpdateState(state);
        updateQueue.upsertItem(appUpdateItem(state));
        pushToShells("app-update-state", state);
    }, TASK_TIMEOUT_MS, mode);
    return session;
}

/** Where the user gets the latest Paperboard: their deb or rpm, else the downloads page. */
export function appUpdateDownloadUrl(): string {
    return linuxInstall()?.download ?? "https://paperboard.dev/downloads/";
}

// a package install is out (its password prompt is open): a second press
// joins it instead of asking for the password twice
let installing = false;

/**
 * Restart to update: once every page with unsaved work agreed to the quit,
 * restarts into the downloaded update. Resolves false when a page kept it
 * open; throws when there is no update to install.
 */
export async function restartToUpdate(): Promise<boolean> {
    if (getAppUpdateState().status !== "ready") throw new Error("No app update has been downloaded");
    if (installing) return true;
    if (!(await confirmQuit())) return false;
    if (packageUpdater) {
        const updater = packageUpdater;
        installing = true;
        // a refused or failed install shows in the update dialog, and this
        // version keeps running
        void updater.install().then(
            () => {
                agreeToQuit();
                app.relaunch();
                app.quit();
            },
            (err) => {
                installing = false;
                updater.emit("error", err);
            },
        );
        return true;
    }
    autoUpdater!.quitAndInstall(false, true);
    return true;
}

export function disposeAppUpdater(): void {
    session?.dispose();
}

// Paperboard's own download, as the update list shows it
function appUpdateItem(state: AppUpdateState): UpdateItem {
    const status = state.status === "downloading" ? "running"
        : state.status === "failed" ? "failed"
        : "done";
    return {
        key: "app",
        kind: "app",
        computerId: "local",
        computerName: null,
        panelId: null,
        name: "Paperboard",
        version: state.version ?? "",
        status,
        stage: state.status === "downloading" ? "downloading" : null,
        percent: state.status === "downloading" ? state.percent : null,
        bytesLoaded: null,
        bytesTotal: null,
        error: state.status === "failed" ? state.error ?? "The update could not finish" : null,
    };
}
