// Browser mode: Paperboard served to a browser tab by browserHost.ts instead
// of drawn in a window. `--web` opens it in the default browser, signed in.
// `--browser` is the same for development: it prints the sign-in link and
// opens no tab, for an agent's own browser. `--web-port=<n>` picks the port.
import { app, dialog, shell } from "electron";
import * as path from "path";
import { is } from "@electron-toolkit/utils";
import { servePanelAsset } from "./panelServe";
import { servedFrameLook } from "./appSettings";
import { readPanelFileForBrowser, statPanelFileForBrowser, writePanelFileFromBrowser } from "./panelFileTransfer";
import { poolEndpoint } from "./panelFileEndpoint";
import { startBrowserHost, type BrowserHost } from "./browserHost";
import { BrowserSessions } from "./browserSessions";
import { getLocalDir } from "daemon/core/paths";
import { portRefusal } from "daemon/system/ports";
import { createShellInvokeHandlers } from "./communication/shellHandlers";
import { issueContext, sendIssue } from "./issueSend";
import { shellServer } from "./communication/shellServer";
import { launchOptionsFromArgv } from "../shared/launchOptions";
import { applySavedAppSettings, logRendererMessage } from "./communication/shelldata";
import { addShellPushSink } from "./communication/shellPush";
import { logger as log } from "daemon/core/logger";

export const webLaunch = app.commandLine.hasSwitch("web");
export const browserMode = webLaunch || app.commandLine.hasSwitch("browser");

let browserHost: BrowserHost | null = null;
let browserHostStarting: Promise<BrowserHost> | null = null;
let removeBrowserPushSink: (() => void) | null = null;
let browserSessions: BrowserSessions | null = null;

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

// `onServing` runs once the host is up: the tray that brings it back
function ensureBrowserHost(onServing: () => void): Promise<BrowserHost> {
    if (browserHost) return Promise.resolve(browserHost);
    browserHostStarting ??= (async () => {
        const calls = createShellInvokeHandlers({
            appVersion: () => app.getVersion(),
            launchOptions: () => launchOptionsFromArgv(process.argv),
            // the page is drawn by the browser it's open in, not by this process
            graphics: () => ({ gpu: true }),
            openPath: (dir) => shell.openPath(dir),
            appSettingsChanged: applySavedAppSettings,
            sendIssue: (text, details) => sendIssue(text, details, issueContext("browser", app.getVersion(), process.getSystemVersion())),
        });
        browserSessions ??= new BrowserSessions(path.join(getLocalDir(), "browser-sessions.json"));
        const port = browserPort();
        const host = await startBrowserHost({
            port,
            sessions: browserSessions,
            rendererDir: path.join(__dirname, "../renderer"),
            rendererDevUrl: is.dev ? process.env["ELECTRON_RENDERER_URL"] : undefined,
            shell: shellServer<void>("browser", calls, { "renderer-log": logRendererMessage }),
            servePanel: (computerId, panelId, pathname) => servePanelAsset(computerId, panelId, pathname, servedFrameLook()),
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
        onServing();
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
export async function openInBrowser(onServing: () => void): Promise<void> {
    try {
        const host = await ensureBrowserHost(onServing);
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
export async function serveBrowserShell(onServing: () => void): Promise<void> {
    try {
        const host = await ensureBrowserHost(onServing);
        console.log(
            `\nPaperboard is running at ${host.origin}\n` +
                `Sign in (works once, for 5 minutes): ${host.signInUrl()}\n`,
        );
    } catch (err: any) {
        log.error("[Browser] could not serve Paperboard in the browser:", err?.message || err);
        failWindowlessLaunch(err);
    }
}

export function closeBrowserHost(): void {
    removeBrowserPushSink?.();
    removeBrowserPushSink = null;
    void browserHost
        ?.close()
        .catch((err) => log.warn("[Paperboard] browser host close failed:", err));
    browserHost = null;
}
