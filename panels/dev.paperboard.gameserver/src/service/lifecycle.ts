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
import { parseGameruleValue } from "../core/gamerules";
import { loadConfigAndProperties } from "./config";
import { trackPlayerActivity, handleStatResponse, handlePositionResponse } from "./players";
import { assertSingleLine } from "../core/players";
import { checkLogForIssues } from "./diagnostics";
import { onServerOnline } from "./gamerules";
import { type GameServerState, SERVER_PROC_ID, appendCapped, PANEL_ID } from "./types";
import { TRIGGER_IDS } from "./contract";

let lineBuffer = "";
let isRestarting = false;
let stopTimeout: ReturnType<typeof setTimeout> | null = null;

function cancelStopForceKill(): void {
    if (stopTimeout) {
        clearTimeout(stopTimeout);
        stopTimeout = null;
    }
}

// exactly one pending force-kill at a time: a stop/restart issued while a
// previous force-kill is pending cancels and reschedules instead of
// stacking a second timer on the same module-level handle. The timer is
// unref'd so a pending kill never holds the service process open.
function scheduleStopForceKill(
    ctx: ServiceContext<GameServerState>,
    delayMs: number = 15000,
): void {
    cancelStopForceKill();
    stopTimeout = setTimeout(() => {
        stopTimeout = null;
        processApi.kill(SERVER_PROC_ID, "SIGKILL");
        watchForceKill(ctx);
    }, delayMs);
    (stopTimeout as unknown as { unref?: () => void }).unref?.();
}

// test seam: the force-kill is time-based, so tests drive it with short
// delays instead of waiting out the real 15s window
export const __lifecycleTest = {
    scheduleStopForceKill,
    isStopForceKillPending: () => stopTimeout !== null,
};

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

        scheduleStopForceKill(ctx);
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

    scheduleStopForceKill(ctx);
}

export async function sendServerCommand(
    ctx: ServiceContext<GameServerState>,
    cmd: string,
): Promise<void> {
    // every console write passes this boundary: a multi-line value is a
    // second console command injected through the same write. call-site
    // validation (kick/ban reasons) does not replace this check — it is
    // the last line of defense for raw-command callers too, matching
    // sendChatMessage's discipline one action over.
    assertSingleLine(String(cmd), "console command", 500);
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

// gamerule readouts ride the same log stream as every other server line:
// query responses keep the UI honest, write confirmations converge an
// online edit on server truth
function handleGameruleResponse(
    ctx: ServiceContext<GameServerState>,
    clean: string,
): void {
    const parsed = parseGameruleValue(clean);
    if (!parsed) return;
    ctx.setState((prev) => ({
        gamerules: { ...prev.gamerules, [parsed.name]: parsed.value },
    }));
}

export function handleProcessData(
    ctx: ServiceContext<GameServerState>,
    chunk: string,
): void {    lineBuffer += chunk;
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
        handlePositionResponse(ctx, clean);
        handleGameruleResponse(ctx, clean);
        checkLogForIssues(ctx, clean);

        if (
            clean.includes("Done (") ||
            clean.includes("Done in") ||
            clean.includes('For help, type "help"') ||
            clean.includes("Started server")
        ) {
            if (ctx.state.serverStatus !== "online") {
                ctx.setState({ serverStatus: "online" });
                ctx.emitTrigger(TRIGGER_IDS.serverStarted, true);
                // boot-time truth: offline gamerule edits re-apply, then
                // every rule is queried so the UI reads live values
                onServerOnline(ctx).catch((err) =>
                    console.error("[Service:Lifecycle] gamerule boot sync failed:", err),
                );
            }
        } else if (clean.includes("Stopping server") || clean.includes("Saving players")) {
            ctx.setState({ serverStatus: "stopping" });
        }

        const chat = parseChatMessage(line);
        if (chat) {
            ctx.setState({
                chatMessages: appendCapped(ctx.state.chatMessages, chat),
            });
            // only player messages emit the chat-message trigger
            if (chat.sender) {
                ctx.emitTrigger(TRIGGER_IDS.chatMessage, chat);
            }
        }

        ctx.setState({
            serverEntries: appendCapped(ctx.state.serverEntries, parseLogLine(line)),
        });
    }
}

export function handleProcessExit(ctx: ServiceContext<GameServerState>): void {
    cancelStopForceKill();

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
        ctx.emitTrigger(TRIGGER_IDS.serverStopped, true);
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
                cancelStopForceKill();
                ctx.setState({
                    serverStatus: "offline",
                    serverEntries: appendCapped(ctx.state.serverEntries, {
                        type: "warn",
                        content: "[Server] Process stopped.",
                    }),
                });
            }
        } catch (err) {
            clearInterval(poll);
            cancelStopForceKill();
            console.error("[gameserver] server-poll iteration failed:", String(err));
        }
    }, 500);
}
