import {
    app,
    shell,
    BrowserWindow,
    ipcMain,
    Menu,
    protocol,
    nativeTheme,
    nativeImage,
    session,
    powerMonitor,
    dialog,
} from "electron";
import * as fs from "fs";
import * as path from "path";
import { electronApp, optimizer, is } from "@electron-toolkit/utils";
import { startCommunicator, logRendererMessage } from "./communication/communication";
import { allowDevShellOrigin, keepShellNavigation } from "./communication/shellGuard";
import connectionPool from "./communication/papercrane/ConnectionPool";
import { startBackgroundUpdates, disposeAppUpdater } from "./updater";
import { initAppSettingsSync } from "./appSettings";
import { logger } from "../../papercrane/logger";
import {
    TITLEBAR_HEIGHT,
    TITLEBAR_OVERLAY_COLORS,
    TITLEBAR_SYMBOL_COLORS,
    WINDOW_BACKGROUND_COLORS,
} from "../../papercrane/themeConstants";
import { parsePanelHost, servePanelAsset } from "./panelServe";
import { installPanelPermissions, panelPermissionStore } from "./panelPermissionHost";
import { readShellFile, SHELL_HOST, SHELL_ORIGIN, SHELL_SCHEME } from "./shellAssets";
import { readPanelFileForBrowser, statPanelFileForBrowser, writePanelFileFromBrowser } from "./panelFileTransfer";
import { poolEndpoint } from "./panelFileEndpoint";
import { startBrowserHost, type BrowserHost } from "./browserHost";
import { BrowserSessions } from "./browserSessions";
import { getLocalDir } from "../../papercrane/paths";
import { portRefusal } from "../../papercrane/ports";
import { createShellInvokeHandlers, SHARED_SHELL_INVOKE_CHANNELS } from "./communication/shellHandlers";
import { launchOptionsFromArgv } from "../shared/launchOptions";
import { emulatePhone, mobileWindowOptions } from "./mobileMock";
import { applySavedAppSettings } from "./communication/shelldata";
import { addShellPushSink } from "./communication/shellPush";
import { keepAliveWithoutWindows, secondLaunchAction } from "./instancePolicy";
import { createDesktopTray, destroyDesktopTray, hasDesktopTray, refreshDesktopTray } from "./tray";
import { pollTrayCount } from "./trayCount";
import icon from "../../resources/icon.png?asset";
import { installScreenshotTool } from "./screenshotTool";
import { installTextEditContextMenu } from "./contextMenu";
import { relocateElectronData } from "./electronData";
import { relaunchOnX11IfNeeded } from "./displayBackend";
import { setDesktopSupervisorEntry } from "../../papercrane/engineSupervisor";

const log = logger;
// workload supervisors run the bundle electron-vite builds beside this one
setDesktopSupervisorEntry(path.join(__dirname, "supervisor.js"));

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

// `--web`: no window; Paperboard opens in the default browser instead
// (browserHost.ts), signed in. `--browser` is the same for development: it
// prints the sign-in link and opens no tab, for an agent's own browser.
// `--web-port=<n>` picks the port.
const webLaunch = app.commandLine.hasSwitch("web");
const browserMode = webLaunch || app.commandLine.hasSwitch("browser");
// `--mobile`: the phone layout in an iPhone-sized window (mobileMock.ts)
const mobileMode = launchOptionsFromArgv(process.argv).mobile;

if (!app.requestSingleInstanceLock()) {
    app.quit();
    // app.quit() does not stop synchronous module evaluation: without this
    // exit the losing instance keeps registering handlers, protocols, and
    // window hooks below for a process that is already quitting
    process.exit(0);
}
app.on("second-instance", (_event, argv) => {
    // `--browser` asks for the browser shell; anything else is the desktop
    // app, even when this process is in browser mode. Otherwise a stale
    // browser session would silently swallow every later launch.
    switch (secondLaunchAction(argv, Boolean(mainWindowRef && !mainWindowRef.isDestroyed()))) {
        case "web":
            void openInBrowser();
            return;
        case "browser":
            void serveBrowserShell();
            return;
        case "focus":
            if (mainWindowRef!.isMinimized()) mainWindowRef!.restore();
            mainWindowRef!.focus();
            return;
        case "window":
            createWindow();
            return;
    }
});

process.on("uncaughtException", (err) => {
    log.error("[Main] Uncaught exception:", err);
});
process.on("unhandledRejection", (reason) => {
    log.error("[Main] Unhandled rejection:", reason as any);
});

protocol.registerSchemesAsPrivileged([
    // the packaged shell's origin (see shellAssets.ts)
    {
        scheme: SHELL_SCHEME,
        privileges: {
            standard: true,
            secure: true,
            supportFetchAPI: true,
            codeCache: true,
        },
    },
    {
        scheme: "panel",
        privileges: {
            standard: true,
            secure: true,
            supportFetchAPI: true,
            corsEnabled: true,
            codeCache: true,
            stream: true,
        },
    },
]);

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
        if (details.url.startsWith("https://")) {
            shell.openExternal(details.url);
        } else {
            log.warn("[Main] Blocked openExternal for non-https url:", details.url);
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

    if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
        mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
    } else {
        mainWindow.loadURL(`${SHELL_ORIGIN}/index.html`);
    }
}

// ── Browser mode ────────────────────────────────────────────────────────────

let browserHost: BrowserHost | null = null;
let browserHostStarting: Promise<BrowserHost> | null = null;
let removeBrowserPushSink: (() => void) | null = null;

// The installed app keeps one port, so a bookmarked tab finds it again.
// Development builds take any free one and never collide with it; so does
// `--browser`, which is for development too.
const WEB_PORT = 45470;

function browserPort(): number {
    const raw = app.commandLine.getSwitchValue("web-port");
    if (!raw) return is.dev || (app.commandLine.hasSwitch("browser") && !webLaunch) ? 0 : WEB_PORT;
    const port = Number(raw);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error(`--web-port must be a port number (1-65535), got "${raw}"`);
    }
    return port;
}

let browserSessions: BrowserSessions | null = null;

function ensureBrowserHost(): Promise<BrowserHost> {
    if (browserHost) return Promise.resolve(browserHost);
    browserHostStarting ??= (async () => {
        const shared = createShellInvokeHandlers({
            appVersion: () => app.getVersion(),
            launchOptions: () => launchOptionsFromArgv(process.argv),
            // the page is drawn by the browser it's open in, not by this process
            graphics: () => ({ gpu: true }),
            openPath: (dir) => shell.openPath(dir),
        });
        const invoke: Record<string, (args: unknown) => unknown> = {};
        for (const channel of SHARED_SHELL_INVOKE_CHANNELS) invoke[channel] = shared[channel];
        invoke["app-settings-changed"] = () => applySavedAppSettings();
        browserSessions ??= new BrowserSessions(path.join(getLocalDir(), "browser-sessions.json"));
        const port = browserPort();
        const host = await startBrowserHost({
            port,
            sessions: browserSessions,
            rendererDir: path.join(__dirname, "../renderer"),
            rendererDevUrl: is.dev ? process.env["ELECTRON_RENDERER_URL"] : undefined,
            invoke,
            send: {
                "renderer-log": (level, message) => logRendererMessage(level, message),
            },
            servePanel: servePanelAsset,
            panelFiles: {
                stat: (args) => statPanelFileForBrowser(args, poolEndpoint),
                read: (args) => readPanelFileForBrowser(args, poolEndpoint),
                write: (args, body, size) => writePanelFileFromBrowser(args, body, size, poolEndpoint),
            },
        }).catch((err: NodeJS.ErrnoException) => {
            if (!err?.code) throw err;
            throw new Error(
                `Paperboard can't open in the browser on port ${port}: ${portRefusal(err, port)}. ` +
                    "Start it with --web-port=<port> to use another.",
            );
        });
        removeBrowserPushSink = addShellPushSink((channel, payload) => host.push(channel, payload));
        ensureDesktopTray();
        browserHost = host;
        log.info(`[Browser] shell served at ${host.origin}`);
        return host;
    })().finally(() => {
        browserHostStarting = null;
    });
    return browserHostStarting;
}

// A windowless launch that couldn't serve has nothing to show: it exits
// visibly, through quit, so before-quit can stop children and sockets.
function failWindowlessLaunch(err: any): void {
    if (!browserMode || browserHost) return;
    console.error(`Paperboard could not open in the browser: ${err?.message || err}`);
    process.exitCode = 1;
    app.quit();
}

// "Open in Browser" and `--web`: the default browser opens Paperboard,
// signed in with a link that works once
async function openInBrowser(): Promise<void> {
    try {
        const host = await ensureBrowserHost();
        await shell.openExternal(host.signInUrl());
        log.info(`[Browser] opened ${host.origin} in the default browser`);
    } catch (err: any) {
        log.error("[Browser] could not open Paperboard in the browser:", err?.message || err);
        dialog.showErrorBox("Paperboard couldn't open in the browser", err?.message || String(err));
        failWindowlessLaunch(err);
    }
}

// `--browser`, for development: serves the shell and prints a sign-in link
// instead of opening a tab (an agent's own browser goes there)
async function serveBrowserShell(): Promise<void> {
    try {
        const host = await ensureBrowserHost();
        console.log(
            `\nPaperboard is running at ${host.origin}\n` +
                `Sign in (works once, for 5 minutes): ${host.signInUrl()}\n`,
        );
    } catch (err: any) {
        log.error("[Browser] could not serve Paperboard in the browser:", err?.message || err);
        failWindowlessLaunch(err);
    }
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
        // existsSync never throws meaningfully — no try/catch fallback needed
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
    // selection gets copy/select-all. Non-text UI returns null so custom DOM
    // menus keep owning their own right clicks.
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

    try {
        await connectionPool.init();
        log.info("[Main] ConnectionPool ready");
    } catch (e: any) {
        log.warn(
            "[Paperboard] ConnectionPool initialization warning:",
            e.message,
        );
    }

    // teardown wired into before-quit: the mDNS browser must not outlive
    // its owner (bounded everything)
    stopCommunicator = startCommunicator(ipcMain);
    initAppSettingsSync();

    // panel://<computerId>.<panelId>/<path> — serving is shared with the
    // browser-mode host (panelServe.ts)
    const handlePanelProtocol = async (request: Request) => {
        const parsedUrl = new URL(request.url);
        const parsedHost = parsePanelHost(parsedUrl.hostname);
        if (!parsedHost) {
            return new Response(
                `Malformed panel URL: missing computer scope prefix`,
                { status: 400 },
            );
        }
        return servePanelAsset(parsedHost.comp, parsedHost.panelId, parsedUrl.pathname);
    };

    protocol.handle("panel", handlePanelProtocol);

    const rendererDir = path.join(__dirname, "../renderer");
    protocol.handle(SHELL_SCHEME, async (request: Request) => {
        const url = new URL(request.url);
        if (url.host !== SHELL_HOST) return new Response("Not found", { status: 404 });
        const file = await readShellFile(rendererDir, url.pathname);
        if (!file.ok) return new Response(null, { status: file.status });
        return new Response(new Uint8Array(file.data), { headers: file.headers });
    });

    if (browserMode) {
        // no background updates either: they run when Paperboard next
        // runs as a window
        for (const signal of ["SIGINT", "SIGTERM"] as const) {
            process.on(signal, () => app.quit());
        }
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
});

app.on("window-all-closed", () => {
    // With a tray, the app lives on with no windows so services keep
    // running; without one (browser mode is windowless anyway) the platform
    // rule decides, as before.
    if (browserMode || hasDesktopTray()) return;
    if (!keepAliveWithoutWindows(process.platform, browserMode)) {
        app.quit();
    }
});

// kill local processes and disconnect clients on quit
app.on("before-quit", () => {
    stopScreenshotTool?.();
    disposeAppUpdater();
    quitting = true;
    log.info("[Main] quitting; cleaning up local processes and connections");
    try {
        connectionPool.dispose();
    } catch (err: any) {
        log.warn("[Paperboard] cleanup warning:", err?.message);
    }
    removeBrowserPushSink?.();
    removeBrowserPushSink = null;
    stopTrayPoll?.();
    stopTrayPoll = null;
    destroyDesktopTray();
    void browserHost
        ?.close()
        .catch((err) => log.warn("[Paperboard] browser host close failed:", err));
    browserHost = null;
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
