import { WebSocketServer, WebSocket } from "ws";
import * as os from "os";
import * as fs from "fs";
import * as crypto from "crypto";
import { spawn } from "child_process";
import { WebSocket as UpstreamWebSocket } from "ws";
import { PaperCraneEngine } from "./engine";
import { PaperCraneAuth } from "./auth";
import { readRemotes } from "./remotes";
import { getDetailedOsInfo, getNetworkIp } from "./index";
import { logger } from "./logger";
import pkg from "../package.json";

// Strict origin allowlist: parses the Origin header as a URL and matches
// hostname exactly. Substring matching previously let origins like
// "evil-localhost.attacker.com" through.
export function isAllowedOrigin(origin: string): boolean {
    if (!origin) return false;
    const lower = origin.toLowerCase();
    // Electron/webview custom schemes have an opaque origin of scheme://
    if (
        lower.startsWith("vscode-webview:") ||
        lower.startsWith("electron:") ||
        lower.startsWith("paperboard:") ||
        lower.startsWith("panel:") ||
        lower.startsWith("board:") ||
        lower.startsWith("file:")
    ) {
        return true;
    }
    try {
        const url = new URL(lower);
        return (
            url.hostname === "localhost" ||
            url.hostname === "127.0.0.1" ||
            url.hostname === "::1" ||
            url.hostname === "[::1]"
        );
    } catch {
        return false;
    }
}

// Validates a self-update download URL: must be https or a loopback http URL
function isSafeUpdateUrl(rawUrl: string): boolean {
    try {
        const url = new URL(rawUrl);
        if (url.protocol === "https:") return true;
        if (url.protocol === "http:") {
            return (
                url.hostname === "localhost" ||
                url.hostname === "127.0.0.1" ||
                url.hostname === "[::1]"
            );
        }
        return false;
    } catch {
        return false;
    }
}

// WebSocket RPC server handling remote protocol methods
/** Per-connection tunnels to paired remote daemons. */
interface TunnelOptions {
    remotesFile?: string;
    staticToken?: string | null;
}

export function setupWebSocketServer(
    wss: WebSocketServer,
    engine: PaperCraneEngine,
    auth: PaperCraneAuth,
    options: TunnelOptions = {},
) {
    wss.on("connection", (ws: WebSocket, req: any) => {
        const origin = (req.headers.origin || "").toLowerCase();
        // Absent Origin headers are allowed: non-browser clients (the app's
        // own PaperCraneClient, scripts) don't send one. Browsers always do.
        if (origin && !isAllowedOrigin(origin)) {
            ws.close(4403, "Forbidden Origin");
            return;
        }

        let isAuthenticated = Boolean(auth.noAuth);

        // Tunnels to paired remote daemons, keyed by tunnel id. Frames arrive
        // wrapped as { type: "tunnel", id, payload } and are piped verbatim.
        const tunnels = new Map<string, UpstreamWebSocket>();

        const sendEvent = (event: string, payload: any) => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: "event", event, payload }));
            }
        };

        ws.on("message", async (raw: any) => {
            try {
                let text = raw.toString("utf8");
                const maybe = JSON.parse(text);

                // Tunneled frames bypass the local RPC pipeline entirely
                if (maybe && typeof maybe === "object" && maybe.type === "tunnel") {
                    const upstream = tunnels.get(maybe.id);
                    if (upstream && upstream.readyState === UpstreamWebSocket.OPEN) {
                        upstream.send(typeof maybe.payload === "string" ? maybe.payload : JSON.stringify(maybe.payload));
                    }
                    return;
                }

                if (maybe && typeof maybe === "object" && maybe.type === "remote:open") {
                    // Accept both field spellings from clients
                    const tunnelId = maybe.tunnelId ?? maybe.id;
                    const computerId = maybe.computerId;
                    const entry = readRemotes(options.remotesFile).find(
                        (r) => r.id === computerId || r.name === computerId,
                    );
                    if (!entry) {
                        ws.send(JSON.stringify({ type: "tunnel-closed", id: tunnelId, reason: "unknown-computer" }));
                        return;
                    }
                    try {
                        const upstream = new UpstreamWebSocket(`ws://${entry.host}:${entry.port}`);
                        tunnels.set(tunnelId, upstream);
                        upstream.on("open", () => {
                            upstream.send(JSON.stringify({
                                id: "__tunnel-auth",
                                action: "auth:verify",
                                params: { token: entry.token },
                            }));
                        });
                        upstream.on("message", (data: any) => {
                            // Swallow everything until the handshake result arrives
                            if (upstream.readyState !== UpstreamWebSocket.OPEN) return;
                            try {
                                const m = JSON.parse(data.toString("utf8"));
                                if (m?.id === "__tunnel-auth") {
                                    if (m.error) {
                                        ws.send(JSON.stringify({ type: "tunnel-closed", id: tunnelId, reason: "auth-failed" }));
                                        upstream.close();
                                        tunnels.delete(tunnelId);
                                    } else {
                                        ws.send(JSON.stringify({ type: "tunnel-open", id: tunnelId }));
                                    }
                                    return;
                                }
                            } catch (err) {
                                // Non-JSON frames before the handshake result are
                                // expected, but log them so dead tunnels are diagnosable.
                                logger.debug(
                                    `[tunnel ${tunnelId}] non-JSON frame during auth handshake:`,
                                    err,
                                );
                            }
                            ws.send(JSON.stringify({ type: "tunnel", id: tunnelId, payload: data.toString("utf8") }));
                        });
                        upstream.on("close", () => {
                            tunnels.delete(tunnelId);
                            ws.send(JSON.stringify({ type: "tunnel-closed", id: tunnelId }));
                        });
                        upstream.on("error", (err) => {
                            logger.debug(
                                `[tunnel ${tunnelId}] upstream connection error:`,
                                err,
                            );
                            tunnels.delete(tunnelId);
                            ws.send(JSON.stringify({ type: "tunnel-closed", id: tunnelId, reason: "unreachable" }));
                        });
                    } catch (err: any) {
                        ws.send(JSON.stringify({ type: "tunnel-closed", id: tunnelId, reason: err?.message || "error" }));
                    }
                    return;
                }

                if (maybe && typeof maybe === "object" && maybe.type === "remote:close") {
                    const upstream = tunnels.get(maybe.id);
                    if (upstream) {
                        tunnels.delete(maybe.id);
                        upstream.close();
                    }
                    return;
                }

                const msg = JSON.parse(text);
                const { id, action, params } = msg;

                const reply = (result: any, error?: string) => {
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ type: "response", id, result, error }));
                    }
                };

                // Authentication handshake
                if (action === "auth:pair") {
                    const result = auth.pair(params?.code, params?.clientName);
                    if (result.success && result.token) {
                        isAuthenticated = true;
                        const osInfo = getDetailedOsInfo();
                        reply({
                            success: true,
                            token: result.token,
                            hostname: os.hostname().replace(/\.local$/i, ""),
                            os: osInfo.os,
                            osVersion: osInfo.osVersion,
                            distroId: osInfo.distroId,
                            distroName: osInfo.distroName,
                            arch: process.arch,
                        });
                    } else {
                        reply(null, result.error || "Pairing failed");
                    }
                    return;
                }

                if (action === "auth:verify") {
                    const valid = auth.verifyToken(params?.token);
                    if (valid) {
                        isAuthenticated = true;
                        const osInfo = getDetailedOsInfo();
                        reply({
                            success: true,
                            hostname: os.hostname().replace(/\.local$/i, ""),
                            os: osInfo.os,
                            osVersion: osInfo.osVersion,
                            distroId: osInfo.distroId,
                            distroName: osInfo.distroName,
                            arch: process.arch,
                        });
                    } else {
                        reply(null, "Invalid authentication token");
                    }
                    return;
                }

                // Verify authorization for all protected actions
                if (!isAuthenticated) {
                    if (params?.token && auth.verifyToken(params.token)) {
                        isAuthenticated = true;
                    } else {
                        reply(null, "Unauthorized. Authentication required.");
                        return;
                    }
                }

                switch (action) {
                    // Terminal RPC
                    case "term:create": {
                        await engine.createTerminal(
                            params.id,
                            params.cols,
                            params.rows,
                            params.cwd,
                            params.env,
                            (data) => sendEvent("term:data", { id: params.id, data }),
                            (exitCode) => sendEvent("term:exit", { id: params.id, exitCode }),
                        );
                        reply({ success: true });
                        break;
                    }
                    case "term:write": {
                        engine.writeTerminal(params.id, params.data);
                        reply({ success: true });
                        break;
                    }
                    case "term:resize": {
                        engine.resizeTerminal(params.id, params.cols, params.rows);
                        reply({ success: true });
                        break;
                    }
                    case "term:attach": {
                        const success = await engine.attachTerminal(
                            params.id,
                            (data) => sendEvent("term:data", { id: params.id, data }),
                            (exitCode) => sendEvent("term:exit", { id: params.id, exitCode }),
                        );
                        reply({ success });
                        break;
                    }
                    case "term:exists": {
                        const running = await engine.isTerminalRunning(params.id);
                        reply({ running });
                        break;
                    }
                    case "term:destroy": {
                        engine.destroyTerminal(params.id);
                        reply({ success: true });
                        break;
                    }

                    // Process RPC
                    case "process:run": {
                        engine.runProcess(
                            params.id,
                            params.command,
                            params.args,
                            params.cwd,
                            params.env,
                            undefined, // onData omitted — stdout & stderr are individually routed below
                            (stdout) => sendEvent("process:data", { id: params.id, data: stdout, stream: "stdout" }),
                            (stderr) => sendEvent("process:data", { id: params.id, data: stderr, stream: "stderr" }),
                        ).then(({ exitCode }) => {
                            sendEvent("process:exit", { id: params.id, exitCode });
                        }).catch((err) => {
                            sendEvent("process:data", { id: params.id, data: `\n[Process Error] ${err.message}\n`, stream: "stderr" });
                            sendEvent("process:exit", { id: params.id, exitCode: 1 });
                        });
                        reply({ success: true });
                        break;
                    }
                    case "process:write": {
                        engine.writeProcess(params.id, params.data);
                        reply({ success: true });
                        break;
                    }
                    case "process:kill": {
                        engine.killProcess(params.id, params.signal);
                        reply({ success: true });
                        break;
                    }
                    case "process:exists": {
                        const running = await engine.isProcessRunning(params.id);
                        reply({ running });
                        break;
                    }
                    case "process:attach": {
                        const success = await engine.attachProcess(
                            params.id,
                            (data) => sendEvent("process:data", { id: params.id, data, stream: "stdout" }),
                            (stdout) => sendEvent("process:data", { id: params.id, data: stdout, stream: "stdout" }),
                            (stderr) => sendEvent("process:data", { id: params.id, data: stderr, stream: "stderr" }),
                            (exitCode) => sendEvent("process:exit", { id: params.id, exitCode }),
                        );
                        reply({ success });
                        break;
                    }

                    // Files RPC
                    case "file:getPath": {
                        reply({ path: engine.getFilePath(params.targetPath, params.appId) });
                        break;
                    }
                    case "file:exists": {
                        reply({ exists: await engine.fileExists(params.targetPath, params.appId) });
                        break;
                    }
                    case "file:write": {
                        reply({ path: await engine.writeFile(params.targetPath, params.content, params.appId) });
                        break;
                    }
                    case "file:read": {
                        reply({ content: await engine.readFile(params.targetPath, params.appId) });
                        break;
                    }
                    case "file:delete": {
                        reply({ success: await engine.deleteFile(params.targetPath, params.appId) });
                        break;
                    }
                    case "file:clear": {
                        reply({ success: await engine.clearFiles(params.appId) });
                        break;
                    }
                    case "file:download": {
                        const dest = await engine.downloadFile(
                            params.url,
                            params.targetPath,
                            params.appId,
                            params.downloadId,
                            params.options || {},
                            (progress) =>
                                sendEvent("progress", {
                                    ...progress,
                                    downloadId: params.downloadId,
                                }),
                        );
                        reply({ path: dest });
                        break;
                    }

                    // Packages RPC
                    case "package:isInstalled": {
                        reply({ installed: engine.isPackageInstalled(params.packageName, params.version) });
                        break;
                    }
                    case "package:getIndex": {
                        reply({ index: engine.getPackageIndex() });
                        break;
                    }
                    case "package:getPath": {
                        reply({ path: engine.getPackagePath(params.packageName) });
                        break;
                    }
                    case "package:download": {
                        const targetDir = await engine.downloadPackage(
                            params.packageName,
                            params.downloadId,
                            (progress) =>
                                sendEvent("progress", {
                                    ...progress,
                                    downloadId: params.downloadId,
                                }),
                        );
                        reply({ path: targetDir });
                        break;
                    }

                    // Panels RPC
                    case "panel:list": {
                        reply({ panels: await engine.listPanels() });
                        break;
                    }
                    case "panel:install": {
                        const manifest = await engine.installPanel(params.panelId, params.downloadUrl, params.sha256);
                        reply({ panel: manifest });
                        break;
                    }
                    case "panel:uninstall": {
                        // Tolerate legacy clients sending a bare string param
                        const panelId =
                            typeof params === "string"
                                ? params
                                : params.panelId ?? params.id;
                        try {
                            const success =
                                await engine.uninstallPanel(panelId);
                            if (!success) {
                                reply(
                                    null,
                                    `Invalid panel id: ${JSON.stringify(panelId)}`,
                                );
                                return;
                            }
                            reply({ success: true });
                        } catch (err: any) {
                            reply(null, `Uninstall failed: ${err?.message}`);
                        }
                        break;
                    }

                    // Configs & System RPC
                    case "config:get": {
                        reply({ data: await engine.getConfig(params.id) });
                        break;
                    }
                    case "config:set": {
                        reply({ success: await engine.setConfig(params.id, params.data) });
                        break;
                    }
                    case "system:ip": {
                        reply({ ip: getNetworkIp() });
                        break;
                    }
                    case "system:info": {
                        const osInfo = getDetailedOsInfo();
                        reply({
                            service: "papercrane",
                            version: pkg.version || "1.0.0",
                            hostname: os.hostname().replace(/\.local$/i, ""),
                            os: osInfo.os,
                            osVersion: osInfo.osVersion,
                            distroId: osInfo.distroId,
                            distroName: osInfo.distroName,
                            arch: process.arch,
                            ip: getNetworkIp(),
                            username: process.env.USER || os.userInfo().username,
                        });
                        break;
                    }
                    case "system:update": {
                        const { downloadUrl, sha256 } = params;
                        if (!downloadUrl || !isSafeUpdateUrl(downloadUrl)) {
                            reply(null, "Refusing update: download URL must be https (or http to localhost)");
                            break;
                        }
                        if (process.platform === "win32") {
                            // Windows cannot rename over a running executable;
                            // the swap must happen from an external updater.
                            reply(null, "Self-update is not supported on Windows yet");
                            break;
                        }
                        reply({ success: true, message: "Update initiated" });
                        setTimeout(async () => {
                            try {
                                const res = await fetch(downloadUrl);
                                if (!res.ok) return;
                                const buffer = Buffer.from(await res.arrayBuffer());
                                if (!sha256) {
                                    console.error("[PaperCrane:Update] Refusing update without sha256");
                                    return;
                                }
                                const actual = crypto
                                    .createHash("sha256")
                                    .update(buffer)
                                    .digest("hex")
                                    .toLowerCase();
                                if (actual !== String(sha256).toLowerCase()) {
                                    console.error(
                                        `[PaperCrane:Update] SHA256 mismatch: expected ${sha256}, got ${actual}`,
                                    );
                                    return;
                                }
                                const execPath = process.execPath;
                                const tmpPath = `${execPath}.tmp-${Date.now()}`;
                                await fs.promises.writeFile(tmpPath, buffer, { mode: 0o755 });
                                await fs.promises.rename(tmpPath, execPath);
                                // Relaunch the new binary detached before
                                // exiting — a self-update must not leave the
                                // machine without a daemon. Embedded
                                // (Electron-hosted) instances are supervised
                                // by the app and must not respawn the app.
                                if (!process.versions.electron) {
                                    try {
                                        const child = spawn(
                                            execPath,
                                            process.argv.slice(1),
                                            {
                                                detached: true,
                                                stdio: "ignore",
                                                env: {
                                                    ...process.env,
                                                    PAPERCRANE_RESPAWNED: "1",
                                                },
                                            },
                                        );
                                        child.on("error", (err) =>
                                            console.error("[PaperCrane:Update] respawn failed:", err),
                                        );
                                        child.unref();
                                        // Give the replacement a moment to
                                        // bind the port before handing off.
                                        await new Promise((r) => setTimeout(r, 300));
                                    } catch (err) {
                                        console.error("[PaperCrane:Update] respawn failed:", err);
                                    }
                                }
                                process.exit(0);
                            } catch (err) {
                                console.error("[PaperCrane:Update:Error]", err);
                            }
                        }, 500);
                        break;
                    }

                    default:
                        reply(null, `Unknown action: ${action}`);
                }
            } catch (err: any) {
                console.error("[PaperCrane:RPC:Error]", err?.message || err);
            }
        });
    });
}
