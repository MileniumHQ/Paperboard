import {
    app,
    shell,
    BrowserWindow,
    ipcMain,
    Menu,
    nativeTheme,
    nativeImage,
    session,
    powerMonitor,
    dialog,
} from "electron";
import * as fs from "fs";
import * as path from "path";
import { electronApp, optimizer, is } from "@electron-toolkit/utils";
import { startCommunicator } from "./communication/communication";
import { allowDevShellOrigin, keepShellNavigation, opensExternally } from "./communication/shellGuard";
import connectionPool from "./communication/papercrane/ConnectionPool";
import { startBackgroundUpdates, stopBackgroundUpdates } from "./updater";
import { disposeAppUpdater } from "./appUpdater";
import { agreeToQuit, holdQuit, quitWithoutAsking } from "./quitGate";
import { initAppSettingsSync } from "./appSettings";
import { logger } from "../../papercrane/logger";
import {
    TITLEBAR_HEIGHT,
    TITLEBAR_OVERLAY_COLORS,
    TITLEBAR_SYMBOL_COLORS,
    WINDOW_BACKGROUND_COLORS,
} from "../../papercrane/themeConstants";
import { installPanelPermissions, panelPermissionStore } from "./panelPermissionHost";
import { SHELL_ORIGIN } from "./shellAssets";
import { handleAppProtocols, registerAppSchemes } from "./protocols";
import { browserMode, closeBrowserHost, openInBrowser as openBrowserTab, serveBrowserShell as serveBrowser, webLaunch } from "./browserMode";
import { launchOptionsFromArgv } from "../shared/launchOptions";
import { emulatePhone, mobileWindowOptions } from "./mobileMock";
import { createDesktopTray, destroyDesktopTray, hasDesktopTray, refreshDesktopTray } from "./tray";
import { pollTrayCount } from "./trayCount";
import icon from "../../resources/icon.png?asset";
import trayTemplateIcon from "../../resources/trayTemplate.png?asset";
import { installScreenshotTool } from "./screenshotTool";
import { installTextEditContextMenu } from "./contextMenu";
import { relocateElectronData } from "./electronData";
import { relaunchOnX11IfNeeded } from "./displayBackend";
import { setSupervisorBinary } from "../../papercrane/supervisorBinary";
import { errorMessage } from "@mileniumhq/paperapi/errors";

const log = logger;
// the workload supervisor ships in the app's resources (scripts/supervisor.ts
// builds it); supervisorBinary.ts copies it out before anything runs from it
setSupervisorBinary(() =>
    fs.promises.readFile(
        path.join(app.getAppPath(), "resources", "supervisor", `${process.platform}-${process.arch}`,
            process.platform === "win32" ? "paperboard-supervisor.exe" : "paperboard-supervisor"),
    ),
);

let mainWindowRef: BrowserWindow | null = null;
// communicator teardown, captured when the shell boots; fired in before-quit
let stopCommunicator: (() => void) | null = null;
// sticky flag so window close-to-tray lets before-quit proceed when the
// user actually quits from the tray/menu instead of looping on hide()
let quitting = false;
let stopScreenshotTool: (() => void) | null = null;

// show (or recreate) the desktop window and focus it
function showMainWindow(): void {
    if (!mainWindowRef || mainWindowRef.isDestroyed()) {
        createWindow();
        return;
    }
    if (mainWindowRef.isMinimized()) mainWindowRef.restore();
    mainWindowRef.show();
    mainWindowRef.focus();
}

// Both launch modes use the same tray and daemon-owned service count.
let desktopTrayCount: number | null = null;
let stopTrayPoll: (() => void) | null = null;

function ensureDesktopTray(): void {
    createDesktopTray({
        icon,
        macTemplateIcon: trayTemplateIcon,
        openWindow: showMainWindow,
        openInBrowser: () => void openInBrowser(),
        runningCount: () => desktopTrayCount,
    });
    stopTrayPoll ??= pollTrayCount({
        read: () => connectionPool.runningServiceCount(),
        render: (count) => {
            desktopTrayCount = count;
            refreshDesktopTray();
        },
        onError: (err) => log.debug("[Tray] service count refresh failed:", err),
    });
}

// the relaunch replaces this process, so nothing below may run first
if (relaunchOnX11IfNeeded(app, process.argv, process.env, process.platform)) process.exit(0);

// before the single-instance lock: it lives in userData
const electronDataError = relocateElectronData(app);

// `--web` and `--browser`: no window; the shell is served to a browser
// (browserMode.ts), and the tray brings it back
const openInBrowser = () => openBrowserTab(ensureDesktopTray);
const serveBrowserShell = () => serveBrowser(ensureDesktopTray);
// `--mobile`: the phone layout in an iPhone-sized window (mobileMock.ts)
const mobileMode = launchOptionsFromArgv(process.argv).mobile;

if (!app.requestSingleInstanceLock()) {
    app.quit();
    // app.quit() does not stop synchronous module evaluation: without this
    // exit the losing instance keeps registering handlers, protocols, and
    // window hooks below for a process that is already quitting
    process.exit(0);
}
// `--web` and `--browser` ask for the browser shell; anything else is the
// desktop app, even when this process is in browser mode, so a stale
// browser session never swallows a later launch. A closed window is
// hidden in the tray, so it is shown, not only focused.
app.on("second-instance", (_event, argv) => {
    if (argv.includes("--web")) void openInBrowser();
    else if (argv.includes("--browser")) void serveBrowserShell();
    else showMainWindow();
});

process.on("uncaughtException", (err) => {
    log.error("[Main] Uncaught exception:", err);
});
process.on("unhandledRejection", (reason) => {
    log.error("[Main] Unhandled rejection:", reason as any);
});

registerAppSchemes();

function getTitleBarOverlayOptions() {
    const isDark = nativeTheme.shouldUseDarkColors;
    return {
        color: isDark
            ? TITLEBAR_OVERLAY_COLORS.dark
            : TITLEBAR_OVERLAY_COLORS.light,
        symbolColor: isDark
            ? TITLEBAR_SYMBOL_COLORS.dark
            : TITLEBAR_SYMBOL_COLORS.light,
        height: TITLEBAR_HEIGHT,
    };
}

function commonWebPreferences() {
    return {
        preload: path.join(__dirname, "../preload/index.js"),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        // no Electron surface in panels
        nodeIntegrationInSubFrames: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
    };
}

function createWindow(): void {
    const isDarwin = process.platform === "darwin";
    const isDark = nativeTheme.shouldUseDarkColors;
    const mainWindow = new BrowserWindow({
        width: 1100,
        height: 720,
        minWidth: 860,
        minHeight: 560,
        show: false,
        autoHideMenuBar: true,
        titleBarStyle: isDarwin ? "hiddenInset" : "hidden",
        titleBarOverlay: isDarwin ? false : getTitleBarOverlayOptions(),
        backgroundColor: isDark
            ? WINDOW_BACKGROUND_COLORS.dark
            : WINDOW_BACKGROUND_COLORS.light,
        ...(process.platform === "linux" ? { icon } : {}),
        ...(mobileMode ? mobileWindowOptions() : {}),
        webPreferences: commonWebPreferences(),
    });
    if (mobileMode) {
        emulatePhone(mainWindow.webContents).catch((err) =>
            log.error("[Mobile] touch emulation is off; the mouse stays a mouse:", err?.message || err),
        );
    }

    mainWindowRef = mainWindow;
    mainWindow.on("closed", () => {
        if (mainWindowRef === mainWindow) mainWindowRef = null;
    });

    // closing the window hides Paperboard to the tray; running services keep
    // going and the tray icon brings the window back. Quit from the tray or
    // an explicit app.quit() really closes.
    // Windows logging off or shutting down
    mainWindow.on("session-end", agreeToQuit);
    mainWindow.on("close", (event) => {
        if (quitting) return;
        event.preventDefault();
        mainWindow.hide();
    });
    ensureDesktopTray();

    mainWindow.on("ready-to-show", () => {
        mainWindow.show();
    });

    // the shell document never leaves the shell: a navigated-to page (a
    // dropped file, a followed link) would inherit the preload
    mainWindow.webContents.on("will-navigate", (event, url) => {
        if (!keepShellNavigation(event, url)) log.warn("[Main] Blocked shell navigation to", url);
    });

    mainWindow.webContents.setWindowOpenHandler((details) => {
        if (opensExternally(details.url)) {
            shell.openExternal(details.url).catch((err) => {
                log.error("[Main] The system could not open", details.url, err);
                dialog.showErrorBox("Paperboard couldn't open that link", `${details.url}\n\n${err?.message || err}`);
            });
        } else {
            log.warn("[Main] Blocked openExternal for a url that is neither https nor on this computer:", details.url);
        }
        return { action: "deny" };
    });

    // no menu bar; devtools toggle only in dev builds (never in shipped ones)
    if (is.dev) {
        mainWindow.webContents.on("before-input-event", (_event, input) => {
            if (input.type !== "keyDown" || input.key.toLowerCase() !== "i") {
                return;
            }
            const combo =
                process.platform === "darwin"
                    ? input.meta && !input.control && (input.shift || input.alt)
                    : input.control && input.shift && !input.meta;
            if (combo) mainWindow.webContents.toggleDevTools();
        });
    } else {
        // explicit escape hatch for support sessions, opt-in by flag
        if (app.commandLine.hasSwitch("devtools")) {
            mainWindow.webContents.openDevTools({ mode: "detach" });
        }
    }

    const shellUrl = is.dev && process.env["ELECTRON_RENDERER_URL"] ? process.env["ELECTRON_RENDERER_URL"] : `${SHELL_ORIGIN}/index.html`;
    // a shell that didn't load is an empty window: say why
    mainWindow.loadURL(shellUrl).catch((err) => {
        log.error("[Main] the window couldn't load", shellUrl, err);
        dialog.showErrorBox("Paperboard couldn't load its window", `${shellUrl}\n\n${err?.message || err}`);
    });
}

app.whenReady().then(async () => {
    if (electronDataError) {
        log.error("[Main]", electronDataError.message);
        dialog.showErrorBox("Paperboard's app data", electronDataError.message);
    }
    // the dev renderer server is a shell origin in development only
    if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
        allowDevShellOrigin(process.env["ELECTRON_RENDERER_URL"]);
    }
    // icon unpacked in prod, resources/ in dev
    if (process.platform === "darwin") {
        const iconCandidates = [
            path.join(process.resourcesPath, "app.asar.unpacked", "resources", "icon.png"),
            path.join(__dirname, "../../resources/icon.png"),
        ];
        const iconPath = iconCandidates.find((p) => fs.existsSync(p));
        app.setAboutPanelOptions({
            applicationName: "Paperboard",
            applicationVersion: app.getVersion(),
            copyright: "2026 Milenium",
            ...(iconPath ? { icon: nativeImage.createFromPath(iconPath) } : {}),
        });
    }
    electronApp.setAppUserModelId("dev.paperboard.paperboard");
    // right-clicking Paperboard on the Windows taskbar offers the browser
    // too; the task relaunches with --web, which the running app answers
    if (process.platform === "win32" && app.isPackaged) {
        const added = app.setUserTasks([
            {
                program: process.execPath,
                arguments: "--web",
                iconPath: process.execPath,
                iconIndex: 0,
                title: "Open in Browser",
                description: "Open Paperboard in your default browser",
            },
        ]);
        if (!added) log.warn("[Main] Windows didn't take the taskbar's Open in Browser task");
    }

    if (process.platform === "darwin") {
        const template: Electron.MenuItemConstructorOptions[] = [
            {
                label: app.name,
                submenu: [{ role: "about" }, { type: "separator" }, { role: "quit" }],
            },
            {
                label: "Edit",
                submenu: [{ role: "copy" }, { role: "paste" }],
            },
        ];
        Menu.setApplicationMenu(Menu.buildFromTemplate(template));
    } else {
        Menu.setApplicationMenu(null);
    }

    // what panel documents may use: the clipboard always, and the
    // microphone, camera and screen once you've said yes (panelPermissionHost.ts)
    installPanelPermissions(session.defaultSession, panelPermissionStore());
    app.on("browser-window-created", (_, window) => {
        optimizer.watchWindowShortcuts(window);
    });
    // Electron ships no default context menu, so a right click on a text field
    // is inert. Give editable fields the standard edit menu; a bare text
    // selection gets copy (contextMenu.ts says why there is no select-all).
    // Non-text UI returns null so custom DOM menus keep owning their own
    // right clicks.
    app.on("web-contents-created", (_event, contents) => {
        installTextEditContextMenu(contents, (template) => {
            const window = BrowserWindow.fromWebContents(contents);
            if (!window) return;
            Menu.buildFromTemplate(template).popup({ window });
        });
    });
    const controllerUrl = is.dev && process.env["ELECTRON_RENDERER_URL"]
        ? new URL("screenshot.html", process.env["ELECTRON_RENDERER_URL"]).href
        : `${SHELL_ORIGIN}/screenshot.html`;
    stopScreenshotTool = installScreenshotTool(controllerUrl);

    log.info(
        `Paperboard v${app.getVersion()} starting (electron ${process.versions.electron}, node ${process.versions.node}, ${process.platform}-${process.arch})`,
    );

    // after sleep a remote's socket can look open while its peer is gone;
    // recheck every computer at once instead of waiting for the heartbeat
    powerMonitor.on("resume", () => connectionPool.wake());
    powerMonitor.on("unlock-screen", () => connectionPool.wake());

    // every computer stays listed either way; the failure is this
    // computer's OS details, which the rail and updates go without
    await connectionPool.init().then(
        () => log.info("[Main] ConnectionPool ready"),
        (err) => log.error("[Main]", errorMessage(err)),
    );

    // teardown wired into before-quit: the mDNS browser must not outlive
    // its owner (bounded everything)
    stopCommunicator = startCommunicator(ipcMain);
    initAppSettingsSync();

    handleAppProtocols(path.join(__dirname, "../renderer"));

    // a signal or the system shutting down quits without asking
    for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, quitWithoutAsking);
    powerMonitor.on("shutdown", quitWithoutAsking);
    if (browserMode) {
        // no background updates either: they run when Paperboard next
        // runs as a window
        if (webLaunch) await openInBrowser();
        else await serveBrowserShell();
    } else {
        createWindow();
        // updates run in the background; the top bar lists them
        startBackgroundUpdates(process.argv);
    }

    app.on("activate", function () {
        if (browserMode) {
            void (webLaunch ? openInBrowser() : serveBrowserShell());
            return;
        }
        // click on the dock/Taskbar icon: bring back the (hidden) window
        showMainWindow();
    });
}).catch((err) => {
    // a start that broke halfway may have no window to say it in
    log.error("[Main] Paperboard couldn't start:", err);
    dialog.showErrorBox("Paperboard couldn't start", errorMessage(err));
    quitWithoutAsking();
});

app.on("window-all-closed", () => {
    // With a tray, the app lives on with no windows so services keep
    // running (browser mode is windowless anyway); without one, macOS apps
    // outlive their windows and every other platform quits.
    if (browserMode || hasDesktopTray() || process.platform === "darwin") return;
    app.quit();
});

// kill local processes and disconnect clients on quit
app.on("before-quit", (event) => {
    // a quit the person asked for waits while pages with unsaved work ask
    if (holdQuit(event)) return;
    stopScreenshotTool?.();
    disposeAppUpdater();
    stopBackgroundUpdates();
    quitting = true;
    log.info("[Main] quitting; cleaning up local processes and connections");
    try {
        connectionPool.dispose();
    } catch (err: any) {
        log.warn("[Paperboard] cleanup warning:", err?.message);
    }
    closeBrowserHost();
    stopTrayPoll?.();
    stopTrayPoll = null;
    destroyDesktopTray();
    // the mDNS browser cannot outlive the app either
    try {
        stopCommunicator?.();
    } catch (err: any) {
        log.warn("[Paperboard] communicator teardown warning:", err?.message);
    }
    // best-effort remote teardown; server expiry is backstop. The import
    // resolves later, so the promise carries its own catch
    void import("./remoteFolder")
        .then((m) => m.closeAllRemoteFolders())
        .catch((err) => log.warn("[Paperboard] remote folder close failed:", err));
});
