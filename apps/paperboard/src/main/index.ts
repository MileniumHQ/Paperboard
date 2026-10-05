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
} from "electron";
import * as fs from "fs";
import * as path from "path";
import { electronApp, optimizer, is } from "@electron-toolkit/utils";
import { startCommunicator, logRendererMessage } from "./communication/communication";
import { allowDevShellOrigin, isRefusedFrame, keepShellNavigation } from "./communication/shellGuard";
import connectionPool from "./communication/papercrane/ConnectionPool";
import { shouldSkipUpdate, runUpdateOrchestrator, disposeAppUpdater } from "./updater";
import { initAppSettingsSync } from "./appSettings";
import { logger } from "../../papercrane/logger";
import {
    TITLEBAR_OVERLAY_COLORS,
    TITLEBAR_SYMBOL_COLORS,
    WINDOW_BACKGROUND_COLORS,
} from "../../papercrane/themeConstants";
import { parsePanelHost, servePanelAsset } from "./panelServe";
import { readShellFile, SHELL_HOST, SHELL_ORIGIN, SHELL_SCHEME } from "./shellAssets";
import { startBrowserHost, type BrowserHost } from "./browserHost";
import { createShellInvokeHandlers, SHARED_SHELL_INVOKE_CHANNELS } from "./communication/shellHandlers";
import { applySavedAppSettings } from "./communication/shelldata";
import { addShellPushSink } from "./communication/shellPush";
import { keepAliveWithoutWindows, secondLaunchAction } from "./instancePolicy";
import { createDesktopTray, destroyDesktopTray, hasDesktopTray, refreshDesktopTray } from "./tray";
import { pollTrayCount } from "./trayCount";
import icon from "../../resources/icon.png?asset";

const log = logger;

let mainWindowRef: BrowserWindow | null = null;
// communicator teardown, captured when the shell boots; fired in before-quit
let stopCommunicator: (() => void) | null = null;
// sticky flag so window close-to-tray lets before-quit proceed when the
// user actually quits from the tray/menu instead of looping on hide()
let quitting = false;

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

// `--browser`: no windows; the shell opens in the user's browser, served by
// browserHost.ts. `--browser-port=<n>` pins the port (default: any free one).
const browserMode = app.commandLine.hasSwitch("browser");

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
        case "browser":
            void openInBrowser();
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
        height: 38,
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
        webPreferences: commonWebPreferences(),
    });

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

function browserPortSwitch(): number {
    const raw = app.commandLine.getSwitchValue("browser-port");
    if (!raw) return 0;
    const port = Number(raw);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error(`--browser-port must be a port number (1-65535), got "${raw}"`);
    }
    return port;
}

function ensureBrowserHost(): Promise<BrowserHost> {
    if (browserHost) return Promise.resolve(browserHost);
    browserHostStarting ??= (async () => {
        const shared = createShellInvokeHandlers({
            appVersion: () => app.getVersion(),
            openPath: (dir) => shell.openPath(dir),
        });
        const invoke: Record<string, (args: unknown) => unknown> = {};
        for (const channel of SHARED_SHELL_INVOKE_CHANNELS) invoke[channel] = shared[channel];
        const host = await startBrowserHost({
            port: browserPortSwitch(),
            rendererDir: path.join(__dirname, "../renderer"),
            rendererDevUrl: is.dev ? process.env["ELECTRON_RENDERER_URL"] : undefined,
            invoke,
            send: {
                "renderer-log": (level, message) => logRendererMessage(level, message),
                "app-settings-changed": () => applySavedAppSettings(),
            },
            servePanel: servePanelAsset,
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

// Browser mode is a development tool: there is no sign-in, so opening the
// origin is all that is needed. Never expose the port beyond loopback.
async function openInBrowser(): Promise<void> {
    try {
        const host = await ensureBrowserHost();
        console.log(
            `\nPaperboard (browser, DEV TOOL) is running at ${host.origin}\n` +
                "No sign-in is required; do not expose this port on a network.\n",
        );
        // headless/SSH: there is no browser here to open; let the remote user
        // open the origin themselves
        if (process.env.PAPERBOARD_NO_BROWSER === "1") return;
        await shell.openExternal(host.origin);
    } catch (err: any) {
        log.error("[Browser] could not open Paperboard in the browser:", err?.message || err);
        if (browserMode && !browserHost) {
            // nothing is serving and there are no windows: exit visibly but
            // through quit, so before-quit can stop children and sockets
            console.error(`Paperboard could not start browser mode: ${err?.message || err}`);
            process.exitCode = 1;
            app.quit();
        }
    }
}

function createUpdaterWindow(): BrowserWindow {
    const updaterWindow = new BrowserWindow({
        width: 380,
        height: 180,
        show: false,
        frame: false,
        transparent: true,
        backgroundColor: "#00000000",
        resizable: false,
        center: true,
        hasShadow: true,
        ...(process.platform === "linux" ? { icon } : {}),
        webPreferences: commonWebPreferences(),
    });

    updaterWindow.webContents.on("will-navigate", (event, url) => {
        if (!keepShellNavigation(event, url)) log.warn("[Main] Blocked updater navigation to", url);
    });
    updaterWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

    updaterWindow.on("ready-to-show", () => {
        updaterWindow.show();
    });

    if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
        updaterWindow.loadURL(
            `${process.env["ELECTRON_RENDERER_URL"]}/updater.html`,
        );
    } else {
        updaterWindow.loadURL(`${SHELL_ORIGIN}/updater.html`);
    }

    return updaterWindow;
}

app.whenReady().then(async () => {
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

    // clipboard granted to panel origins only
    const isPanelOrigin = (origin: string) =>
        origin.startsWith("panel://") || origin === "panel://";
    // writeText may check "clipboard-write" or "clipboard-sanitized-write"
    // depending on the Chromium release; readText checks "clipboard-read".
    // All three stay panel-scoped.
    const isClipboardPermission = (permission: string) =>
        permission === "clipboard-read" ||
        permission === "clipboard-sanitized-write" ||
        permission === "clipboard-write";
    for (const ses of [session.defaultSession]) {
        ses.setPermissionRequestHandler((_wc, permission, callback, details) => {
            const origin = (() => {
                try {
                    // the requesting frame's URL, not the top frame's:
                    // _wc.getURL() is the shell for panel iframes, which
                    // would deny every panel request evaluated here
                    return new URL(
                        details?.requestingUrl || _wc?.getURL() || "",
                    ).origin;
                } catch (err) {
                    log.debug("[Main] permission origin unparseable, denying:", err);
                    return "";
                }
            })();
            callback(isClipboardPermission(permission) && isPanelOrigin(origin));
        });
        ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) => {
            return (
                isClipboardPermission(permission) && isPanelOrigin(requestingOrigin)
            );
        });
    }
    app.on("browser-window-created", (_, window) => {
        optimizer.watchWindowShortcuts(window);
    });

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
        // no updater pass either: it restarts into a window. Updates apply
        // on the next windowed launch.
        for (const signal of ["SIGINT", "SIGTERM"] as const) {
            process.on(signal, () => app.quit());
        }
        await openInBrowser();
    } else if (shouldSkipUpdate(process.argv)) {
        createWindow();
    } else {
        const updaterWindow = createUpdaterWindow();

        let launched = false;
        const launchMain = () => {
            if (launched) return;
            launched = true;
            if (!updaterWindow.isDestroyed()) updaterWindow.close();
            createWindow();
        };

        ipcMain.once("updater-finish", (event) => {
            // a panel frame must never be able to skip the update flow.
            // One invariant, one implementation: the check lives in
            // shellGuard.isRefusedFrame, not as an inline copy here.
            if (isRefusedFrame(event)) {
                log.warn('[Shell] PANEL_IPC_REFUSED: channel "updater-finish" is shell-only');
                return;
            }
            launchMain();
        });
        updaterWindow.on("closed", () => {
            if (!launched) launchMain();
        });

        // hard timeout so stalled network can't block launch
        updaterWindow.once("ready-to-show", () => {
            runUpdateOrchestrator(updaterWindow)
                .catch((err) => {
                    log.error("[Updater] Orchestrator error:", err?.message);
                })
                .finally(() => launchMain());
        });
        setTimeout(launchMain, 3 * 60_000).unref?.();
    }

    app.on("activate", function () {
        if (browserMode) {
            void openInBrowser();
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
