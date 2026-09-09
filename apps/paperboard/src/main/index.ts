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
} from "electron";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { electronApp, optimizer, is } from "@electron-toolkit/utils";
import { startCommunicator } from "./communication/communication";
import connectionPool from "./communication/papercrane/ConnectionPool";
import { shouldSkipUpdate, runUpdateOrchestrator } from "./updater";
import { initAppSettingsSync } from "./appSettings";
import { logger } from "../../papercrane/logger";
import { getPanelsDir, getPaperboardDir } from "../../papercrane/paths";
import { sanitizeId } from "../../papercrane/storage";
import icon from "../../resources/icon.png?asset";

const log = logger;

let mainWindowRef: BrowserWindow | null = null;

if (!app.requestSingleInstanceLock()) {
    app.quit();
} else {
    app.on("second-instance", () => {
        if (mainWindowRef && !mainWindowRef.isDestroyed()) {
            if (mainWindowRef.isMinimized()) mainWindowRef.restore();
            mainWindowRef.focus();
        }
    });
}

process.on("uncaughtException", (err) => {
    log.error("[Main] Uncaught exception:", err);
});
process.on("unhandledRejection", (reason) => {
    log.error("[Main] Unhandled rejection:", reason as any);
});

protocol.registerSchemesAsPrivileged([
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
        color: isDark ? "#2a2a2a" : "#e2e6eb",
        symbolColor: isDark ? "#f5f5f5" : "#0f1319",
        height: 38,
    };
}

// per-launch nonce for panel script tags
const PANEL_CSP_NONCE = crypto.randomBytes(16).toString("base64");

const buildPanelCsp = () =>
    [
        "default-src 'self' panel: data: blob:",
        `script-src 'self' 'nonce-${PANEL_CSP_NONCE}'`,
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' panel: data: blob: https: http:",
        "font-src 'self' data:",
        "connect-src 'self' panel: ws://127.0.0.1:* ws://localhost:* https:",
        "media-src 'self' panel: blob: https: http:",
    ].join("; ");

const injectCspNonce = (html: string) =>
    html.replaceAll("<script", `<script nonce="${PANEL_CSP_NONCE}"`);

// panels render outside shell styles; keep the same no-select baseline
const injectUnselectable = (html: string): string => {
    const style = `<style>html{-webkit-user-select:none;user-select:none}input,textarea,select,[contenteditable="true"],[contenteditable=""]{-webkit-user-select:text;user-select:text}code,pre,kbd,samp,[data-selectable="true"]{-webkit-user-select:text;user-select:text}</style>`;
    if (/<head[^>]*>/i.test(html)) {
        return html.replace(/<head[^>]*>/i, (m) => `${m}${style}`);
    }
    return `${style}${html}`;
};

const readCraneCreds = (): { port: number; token: string } | null => {
    try {
        const handshakeFile = path.join(getPaperboardDir(), "local", "crane.json");
        const creds = JSON.parse(fs.readFileSync(handshakeFile, "utf8"));
        return { port: creds.port, token: creds.token };
    } catch {
        return null;
    }
};

// inject computer-scoped creds; scope comes from serving URL
const injectCraneCreds = (
    html: string,
    comp: string,
): string => {
    const creds = readCraneCreds();
    const payload = creds
        ? JSON.stringify({ ...creds, computerId: comp })
        : "null";
    const bootstrap = `<script>window.__PAPERBOARD_CRANE=${payload};</script>`;
    if (/<head[^>]*>/i.test(html)) {
        return html.replace(/<head[^>]*>/i, (m) => `${m}${bootstrap}`);
    }
    // no <head> — prepend; scripts run before body anyway
    return `${bootstrap}${html}`;
};

import { lookupMime as lookupMimeType } from "../../papercrane/mime";

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
        backgroundColor: isDark ? "#121316" : "#ffffff",
        ...(process.platform === "linux" ? { icon } : {}),
        webPreferences: commonWebPreferences(),
    });

    mainWindowRef = mainWindow;
    mainWindow.on("closed", () => {
        if (mainWindowRef === mainWindow) mainWindowRef = null;
    });

    mainWindow.on("ready-to-show", () => {
        mainWindow.show();
    });

    mainWindow.webContents.setWindowOpenHandler((details) => {
        if (details.url.startsWith("https://")) {
            shell.openExternal(details.url);
        } else {
            log.warn("[Main] Blocked openExternal for non-https url:", details.url);
        }
        return { action: "deny" };
    });

    // no menu bar, so longish shortcuts toggle devtools
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

    if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
        mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
    } else {
        mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
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

    updaterWindow.on("ready-to-show", () => {
        updaterWindow.show();
    });

    if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
        updaterWindow.loadURL(
            `${process.env["ELECTRON_RENDERER_URL"]}/updater.html`,
        );
    } else {
        updaterWindow.loadFile(path.join(__dirname, "../renderer/updater.html"));
    }

    return updaterWindow;
}

app.whenReady().then(async () => {
    // icon unpacked in prod, resources/ in dev
    if (process.platform === "darwin") {
        const iconCandidates = [
            path.join(process.resourcesPath, "app.asar.unpacked", "resources", "icon.png"),
            path.join(__dirname, "../../resources/icon.png"),
        ];
        const iconPath = iconCandidates.find((p) => {
            try {
                return fs.existsSync(p);
            } catch {
                return false;
            }
        });
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
    for (const ses of [session.defaultSession]) {
        ses.setPermissionRequestHandler((_wc, permission, callback) => {
            const origin = (() => {
                try {
                    return new URL(_wc?.getURL() ?? "").origin;
                } catch {
                    return "";
                }
            })();
            callback(
                (permission === "clipboard-read" ||
                    permission === "clipboard-sanitized-write") &&
                    isPanelOrigin(origin),
            );
        });
        ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) => {
            return (
                (permission === "clipboard-read" ||
                    permission === "clipboard-sanitized-write") &&
                isPanelOrigin(requestingOrigin)
            );
        });
    }
    app.on("browser-window-created", (_, window) => {
        optimizer.watchWindowShortcuts(window);
    });

    log.info(
        `Paperboard v${app.getVersion()} starting (electron ${process.versions.electron}, node ${process.versions.node}, ${process.platform}-${process.arch})`,
    );

    try {
        await connectionPool.init();
        log.info("[Main] ConnectionPool ready");
    } catch (e: any) {
        log.warn(
            "[Paperboard] ConnectionPool initialization warning:",
            e.message,
        );
    }

    startCommunicator(ipcMain);
    initAppSettingsSync();

    // panel://<computerId>.<panelId>/<path> — scope is part of origin
    const parsePanelHost = (
        hostname: string,
    ): { comp: string; panelId: string } | null => {
        const dot = hostname.indexOf(".");
        if (dot <= 0) return null;
        return { comp: hostname.slice(0, dot), panelId: hostname.slice(dot + 1) };
    };

    const handlePanelProtocol = async (request: Request) => {
        try {
            const parsedUrl = new URL(request.url);
            const parsedHost = parsePanelHost(parsedUrl.hostname);
            if (!parsedHost) {
                return new Response(
                    `Malformed panel URL: missing computer scope prefix`,
                    { status: 400 },
                );
            }
            const { comp: urlComp, panelId } = parsedHost;

            // deliberately no fallback to active computer
            const comp = urlComp === "local" || connectionPool.getComputer(urlComp) ? urlComp : null;
            if (!comp) {
                return new Response(`Unknown computer: ${urlComp}`, {
                    status: 404,
                });
            }

            let subpath = parsedUrl.pathname.replace(/^\/+/, "");
            if (!subpath) subpath = "index.html";

            const cleanPanelId = sanitizeId(panelId);
            if (!cleanPanelId) {
                return new Response(`Invalid panel id`, { status: 400 });
            }

            const assetComp = comp;

            // Local machine: serve straight from the panels directory
            if (assetComp === "local") {
                const panelsDir = getPanelsDir();
                const panelDir = path.join(panelsDir, cleanPanelId);

                if (fs.existsSync(panelDir)) {
                    // containment check before touching disk
                    const normalized = path.normalize(
                        subpath.replace(/^[/\\]+/, ""),
                    );
                    const resolved = path.resolve(panelDir, normalized);
                    if (
                        resolved !== panelDir &&
                        !resolved.startsWith(
                            panelDir.endsWith(path.sep)
                                ? panelDir
                                : panelDir + path.sep,
                        )
                    ) {
                        return new Response(`Forbidden`, { status: 403 });
                    }
                    // dist build wins over loose files
                    const distCandidate = path.join(panelDir, "dist", normalized);
                    let targetFile: string | null = null;
                    if (fs.existsSync(distCandidate)) {
                        targetFile = distCandidate;
                    } else if (fs.existsSync(resolved)) {
                        targetFile = resolved;
                    }

                    try {
                        if (
                            targetFile !== null &&
                            fs.statSync(targetFile).isFile()
                        ) {
                            const buffer = await fs.promises.readFile(
                                targetFile,
                            );
                            const ext = path.extname(targetFile).toLowerCase();
                            const contentType = lookupMimeType(ext);
                            const headers: Record<string, string> = {
                                "Content-Type": contentType,
                                "X-Content-Type-Options": "nosniff",
                                "Access-Control-Allow-Origin": "*",
                                "Cache-Control": "no-store",
                            };
                            if (ext === ".html") {
                                headers["Content-Security-Policy"] =
                                    buildPanelCsp();
                                headers["Cache-Control"] = "no-store";
                                const html = injectCspNonce(
                                    injectUnselectable(
                                        injectCraneCreds(
                                            buffer.toString("utf8"),
                                            comp,
                                        ),
                                    ),
                                );
                                return new Response(html, { headers });
                            }
                            return new Response(buffer, { headers });
                        }
                    } catch {
                        // lost race with deletion — fall through to 404
                    }
                }
                return new Response(
                    `Panel file not found: ${cleanPanelId}/${subpath}`,
                    { status: 404 },
                );
            }

            const client = connectionPool.getClient(assetComp);
            const httpUrl = client.getHttpUrl(`panel/${cleanPanelId}/${subpath}`);
            const res = await fetch(httpUrl).catch(() => null);
            if (!res || !res.ok) {
                return new Response(res ? res.statusText : "Not Found", {
                    status: res ? res.status : 404,
                });
            }
            const buffer = await res.arrayBuffer();
            const remoteExt = path.extname(subpath).toLowerCase();
            const contentType =
                res.headers.get("content-type") || lookupMimeType(remoteExt);
            const headers: Record<string, string> = {
                "Content-Type": contentType,
                "X-Content-Type-Options": "nosniff",
                "Access-Control-Allow-Origin": "*",
            };
            let responseBody: BodyInit = buffer;
            if (remoteExt === ".html") {
                headers["Content-Security-Policy"] = buildPanelCsp();
                headers["Cache-Control"] = "no-store";
                responseBody = injectCspNonce(
                    injectUnselectable(
                        injectCraneCreds(
                            new TextDecoder().decode(buffer),
                            comp,
                        ),
                    ),
                );
            }

            return new Response(responseBody, { headers });
        } catch (err: any) {
            log.error("[PanelProtocol] error:", err?.message || err);
            return new Response(`Error: ${err?.message || err}`, { status: 500 });
        }
    };

    protocol.handle("panel", handlePanelProtocol);

    if (shouldSkipUpdate(process.argv)) {
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

        ipcMain.once("updater-finish", launchMain);
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
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        app.quit();
    }
});

// kill local processes and disconnect clients on quit
app.on("before-quit", () => {
    log.info("[Main] quitting — cleaning up local processes and connections");
    try {
        connectionPool.dispose();
    } catch (err: any) {
        log.warn("[Paperboard] cleanup warning:", err?.message);
    }
    // best-effort remote teardown; server expiry is backstop
    try {
        void import("./remoteFolder").then((m) => m.closeAllRemoteFolders());
    } catch {}
});
