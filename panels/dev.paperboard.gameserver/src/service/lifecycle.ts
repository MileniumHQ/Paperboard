import {
    processApi,
    files as fileApi,
    packages as packageApi,
    config,
    system,
    type ServiceContext,
} from "@paperboard-dev/paperapi";
import stripAnsi from "strip-ansi";
import { getRequiredJavaVersion, SOFTWARE_NAMES } from "../lib/software";
import { isWindowsTarget } from "../lib/platform";
import { parseChatMessage, parseLogLine } from "../lib/logs";
import { loadConfigAndProperties } from "./config";
import { trackPlayerActivity, handleStatResponse } from "./players";
import { checkLogForIssues } from "./diagnostics";
import { type GameServerState, SERVER_PROC_ID, appendCapped, PANEL_ID } from "./types";

let lineBuffer = "";
let isRestarting = false;
let stopTimeout: ReturnType<typeof setTimeout> | null = null;

export async function startServerInstance(
    ctx: ServiceContext<GameServerState>,
): Promise<void> {
    if (ctx.state.serverStatus !== "offline") return;
    try {
        ctx.setState({ activeIssue: null });
        await loadConfigAndProperties(ctx);

        let version = ctx.state.serverVersion;
        if (!version) {
            const saved = await config.get<any>(PANEL_ID);
            if (saved?.version) {
                version = saved.version;
                ctx.setState({ serverVersion: version });
            }
        }

        const javaPkg = getRequiredJavaVersion(version);
        if (!javaPkg) {
            throw new Error(
                `Could not determine the Minecraft version (got ${JSON.stringify(version)}) — complete Setup before starting the server.`,
            );
        }
        const isInstalled = await packageApi.isInstalled(javaPkg).catch(() => false);
        if (!isInstalled) {
            throw new Error(
                `Required Java package "${javaPkg}" is not installed. Please run Setup or install it in Packages.`,
            );
        }

        const javaPath = await packageApi.getPath(javaPkg);
        const serverDir = await fileApi.getPath("", PANEL_ID);
        // fail here instead of a confusing "unable to access jarfile" exit
        const hasJar = await fileApi.exists("server.jar", PANEL_ID).catch(() => false);
        if (!hasJar) {
            throw new Error(
                `server.jar is missing in the server folder — run Setup (it downloads the ${SOFTWARE_NAMES[ctx.state.serverSoftware]} ${version || "server"} jar) before starting.`,
            );
        }
        console.log(
            `[Service:Lifecycle] starting in ${serverDir} (server.jar present) using ${javaPkg}...`,
        );
        const targetOs = (await system.getInfo()).os;
        const isWin = isWindowsTarget(serverDir, targetOs);
        const javaBin = `${javaPath}/bin/${isWin ? "java.exe" : "java"}`;

        ctx.setState({
            serverStatus: "starting",
            chatMessages: [],
            serverEntries: [
                {
                    type: "info",
                    content: `[Server] Starting ${SOFTWARE_NAMES[ctx.state.serverSoftware]} ${version || "server"} using ${javaPkg}...`,
                },
            ],
        });

        await processApi.start({
            id: SERVER_PROC_ID,
            command: javaBin,
            args: [
                `-Xmx${ctx.state.ramAllocation}G`,
                `-Xms${ctx.state.ramAllocation}G`,
                "-jar",
                "server.jar",
                "nogui",
            ],
            cwd: serverDir,
            env: { JAVA_HOME: javaPath },
        });
    } catch (err: any) {
        console.error("[Service:Lifecycle] Failed to start server:", err);
        ctx.setState({
            serverStatus: "offline",
            serverEntries: appendCapped(ctx.state.serverEntries, {
                type: "error",
                content: `[Server] Failed to launch: ${err?.message || err}`,
            }),
        });
    }
}

export async function stopServerInstance(
    ctx: ServiceContext<GameServerState>,
): Promise<void> {
    const curr = ctx.state.serverStatus;
    if (curr === "starting") {
        processApi.kill(SERVER_PROC_ID, "SIGKILL");
        ctx.setState({
            serverStatus: "offline",
            serverEntries: appendCapped(ctx.state.serverEntries, {
                type: "warn",
                content: "[Server] Process killed by user.",
            }),
        });
    } else if (curr === "online") {
        ctx.setState({
            serverStatus: "stopping",
            serverEntries: appendCapped(ctx.state.serverEntries, {
                type: "command",
                content: "stop",
            }),
        });
        processApi.write(SERVER_PROC_ID, "stop\n");

        if (!stopTimeout) {
            stopTimeout = setTimeout(() => {
                processApi.kill(SERVER_PROC_ID, "SIGKILL");
                watchForceKill(ctx);
            }, 15000);
        }
    }
}

export async function restartServerInstance(
    ctx: ServiceContext<GameServerState>,
): Promise<void> {
    if (ctx.state.serverStatus !== "online") return;
    isRestarting = true;
    ctx.setState({
        serverStatus: "restarting",
        serverEntries: appendCapped(
            appendCapped(ctx.state.serverEntries, {
                type: "command",
                content: "stop",
            }),
            {
                type: "info",
                content: "[Server] Stopping for restart...",
            },
        ),
    });
    processApi.write(SERVER_PROC_ID, "stop\n");

    if (!stopTimeout) {
        stopTimeout = setTimeout(() => {
            processApi.kill(SERVER_PROC_ID, "SIGKILL");
            watchForceKill(ctx);
        }, 15000);
    }
}

export async function sendServerCommand(
    ctx: ServiceContext<GameServerState>,
    cmd: string,
): Promise<void> {
    const trimmed = cmd.trim();
    if (!trimmed) return;

    if (trimmed === "clear") {
        ctx.setState({ serverEntries: [] });
        return;
    }

    ctx.setState({
        serverEntries: appendCapped(ctx.state.serverEntries, {
            type: "command",
            content: cmd,
        }),
    });

    if (
        ctx.state.serverStatus === "online" ||
        ctx.state.serverStatus === "starting"
    ) {
        const rawCmd = trimmed.startsWith("/") ? trimmed.slice(1) : trimmed;
        processApi.write(SERVER_PROC_ID, `${rawCmd}\n`);
    } else {
        ctx.setState({
            serverEntries: appendCapped(ctx.state.serverEntries, {
                type: "error",
                content: "Cannot execute command: server is offline.",
            }),
        });
    }
}

export async function sendChatMessage(
    ctx: ServiceContext<GameServerState>,
    msg: string,
): Promise<void> {
    const trimmed = msg.trim();
    if (!trimmed) return;

    if (
        ctx.state.serverStatus === "online" ||
        ctx.state.serverStatus === "starting"
    ) {
        processApi.write(SERVER_PROC_ID, `say ${trimmed}\n`);
    } else {
        const now = new Date();
        const timeStr = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
        ctx.setState({
            chatMessages: appendCapped(ctx.state.chatMessages, {
                id: `chat-${Date.now()}`,
                text: "Cannot send message: server is offline.",
                timestamp: timeStr,
            }),
        });
    }
}

export function handleProcessData(
    ctx: ServiceContext<GameServerState>,
    chunk: string,
): void {
    lineBuffer += chunk;
    const lines = lineBuffer.split("\n");
    lineBuffer = lines.pop() ?? "";

    for (const line of lines) {
        const clean = stripAnsi(line);
        if (!clean.trim()) continue;

        const portMatch = clean.match(/Starting (?:Minecraft )?server on .*:(\d+)/i);
        if (portMatch?.[1] && portMatch[1] !== "0") {
            ctx.setState({ serverPort: portMatch[1] });
        }

        trackPlayerActivity(ctx, clean);
        handleStatResponse(ctx, clean);
        checkLogForIssues(ctx, clean);

        if (
            clean.includes("Done (") ||
            clean.includes("Done in") ||
            clean.includes('For help, type "help"') ||
            clean.includes("Started server")
        ) {
            if (ctx.state.serverStatus !== "online") {
                ctx.setState({ serverStatus: "online" });
                ctx.emitTrigger("server-started", true);
            }
        } else if (clean.includes("Stopping server") || clean.includes("Saving players")) {
            ctx.setState({ serverStatus: "stopping" });
        }

        const chat = parseChatMessage(line);
        if (chat) {
            ctx.setState({
                chatMessages: appendCapped(ctx.state.chatMessages, chat),
            });
            // only player messages emit "chat-message"
            if (chat.sender) {
                ctx.emitTrigger("chat-message", chat);
            }
        }

        ctx.setState({
            serverEntries: appendCapped(ctx.state.serverEntries, parseLogLine(line)),
        });
    }
}

export function handleProcessExit(ctx: ServiceContext<GameServerState>): void {
    if (stopTimeout) {
        clearTimeout(stopTimeout);
        stopTimeout = null;
    }

    if (lineBuffer.trim()) {
        const lastChat = parseChatMessage(lineBuffer);
        if (lastChat) {
            ctx.setState({
                chatMessages: appendCapped(ctx.state.chatMessages, lastChat),
            });
        }
        ctx.setState({
            serverEntries: appendCapped(
                ctx.state.serverEntries,
                parseLogLine(lineBuffer),
            ),
        });
        lineBuffer = "";
    }

    if (isRestarting) {
        isRestarting = false;
        ctx.setState({
            serverStatus: "starting",
            onlinePlayers: [],
            serverEntries: appendCapped(ctx.state.serverEntries, {
                type: "info",
                content: "[Server] Restarting instance...",
            }),
        });
        startServerInstance(ctx);
    } else {
        ctx.setState({
            serverStatus: "offline",
            onlinePlayers: [],
            serverEntries: appendCapped(ctx.state.serverEntries, {
                type: "warn",
                content: "[Server] Process stopped.",
            }),
        });
        ctx.emitTrigger("server-stopped", true);
    }
}

function watchForceKill(ctx: ServiceContext<GameServerState>): void {
    const startedAt = Date.now();
    const poll = setInterval(async () => {
        try {
            const stillRunning = await processApi.exists(SERVER_PROC_ID);
            if (!stillRunning || Date.now() - startedAt > 10000) {
                clearInterval(poll);
                isRestarting = false;
                if (stopTimeout) {
                    clearTimeout(stopTimeout);
                    stopTimeout = null;
                }
                ctx.setState({
                    serverStatus: "offline",
                    serverEntries: appendCapped(ctx.state.serverEntries, {
                        type: "warn",
                        content: "[Server] Process stopped.",
                    }),
                });
            }
        } catch {
            clearInterval(poll);
        }
    }, 500);
}
