import { serverLocal } from "./scope";
import { processApi, type ServiceContext } from "./api";
import { currentGame, currentGameService } from "../games/service";
import { assertRecoverySettled } from "./recoveryState";
import { prepareGamePorts } from "./ports";
import { livePortDeps } from "./portDeps";
import { type GameServerState, SERVER_PROC_ID, appendCapped } from "./types";
import { TRIGGER_IDS } from "./contract";

const local = serverLocal(() => ({ lineBuffer: "", isRestarting: false, stopTimeout: null as ReturnType<typeof setTimeout> | null }));

function cancelStopForceKill(): void {
    if (local().stopTimeout) {
        clearTimeout(local().stopTimeout!);
        local().stopTimeout = null;
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
    local().stopTimeout = setTimeout(() => {
        local().stopTimeout = null;
        processApi.kill(SERVER_PROC_ID, "SIGKILL");
        watchForceKill(ctx);
    }, delayMs);
    (local().stopTimeout as unknown as { unref?: () => void }).unref?.();
}

// test seam: the force-kill is time-based, so tests drive it with short
// delays instead of waiting out the real 15s window
export const __lifecycleTest = {
    scheduleStopForceKill,
    isStopForceKillPending: () => local().stopTimeout !== null,
};

export async function startServerInstance(
    ctx: ServiceContext<GameServerState>,
): Promise<void> {
    if (ctx.state.serverStatus !== "offline") return;
    // refused to the caller: a half-settled server folder is not a launch failure
    assertRecoverySettled("starting the server");
    try {
        ctx.setState({ activeIssue: null });
        await currentGameService().loadOptions(ctx);

        const game = currentGameService();
        const launch = await game.prepareLaunch(ctx);

        // the port files are the install's while one runs
        if (currentGameService().isMutating()) {
            throw new Error("A server install is running; start the server once it finishes.");
        }
        // throws, with who has it, when a port is taken and the user's
        // setting refuses to move it
        const moves = await prepareGamePorts(game.ports(ctx, livePortDeps()), livePortDeps());

        // an install owns the server folder until it activates or rolls
        // back. Checked with no await before the status flips: the install
        // action likewise checks "offline" and claims the folder in one
        // synchronous step, so the two can never both proceed.
        if (currentGameService().isMutating()) {
            throw new Error("A server install is running; start the server once it finishes.");
        }
        ctx.setState({
            serverStatus: "starting",
            chatMessages: [],
            serverEntries: [
                {
                    type: "info",
                    content: launch.message,
                },
                ...moves.map((move) => ({
                    type: "warn" as const,
                    content: `[Server] Port ${move.from} is taken, so ${move.label} uses ${move.to}.`,
                })),
            ],
        });

        await processApi.start({
            id: SERVER_PROC_ID,
            command: launch.command.executable,
            args: launch.command.args,
            cwd: launch.command.cwd,
            env: launch.command.env,
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
                content: currentGameService().stopEntry,
            }),
        });
        currentGameService().stop();

        scheduleStopForceKill(ctx);
    }
}

export async function restartServerInstance(
    ctx: ServiceContext<GameServerState>,
): Promise<void> {
    if (ctx.state.serverStatus !== "online") return;
    local().isRestarting = true;
    ctx.setState({
        serverStatus: "restarting",
        serverEntries: appendCapped(
            appendCapped(ctx.state.serverEntries, {
                type: "command",
                content: currentGameService().stopEntry,
            }),
            {
                type: "info",
                content: "[Server] Stopping for restart...",
            },
        ),
    });
    currentGameService().stop();

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
    const game = currentGameService();
    if (currentGame().describe({ software: ctx.state.serverSoftware, version: ctx.state.serverVersion }).control.kind === "none")
        throw new Error("This game does not support console commands");
    const line = game.commandLine(cmd);
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
        await processApi.write(SERVER_PROC_ID, line);
    } else {
        ctx.setState({
            serverEntries: appendCapped(ctx.state.serverEntries, {
                type: "error",
                content: "Cannot execute command: server is offline.",
            }),
        });
        // the console line above is for the player; the caller (an action,
        // a flow) must still see that nothing ran
        throw new Error("Cannot execute command: server is offline.");
    }
}

/** Log viewing is available even when a game has no command control. */
export function handleProcessData(ctx: ServiceContext<GameServerState>, chunk: string): void {
    local().lineBuffer += chunk;
    const lines = local().lineBuffer.split("\n");
    local().lineBuffer = lines.pop() ?? "";
    for (const line of lines) currentGameService().observeLine(ctx, line);
}
export function sendChatMessage(ctx: ServiceContext<GameServerState>, msg: string): Promise<void> {
    const game = currentGameService();
    if (!game.sendChat) throw new Error("This game does not support chat");
    return game.sendChat(ctx, msg);
}

export function handleProcessExit(ctx: ServiceContext<GameServerState>): void {
    cancelStopForceKill();

    if (local().lineBuffer.trim()) {
        currentGameService().observeLine(ctx, local().lineBuffer, true);
        local().lineBuffer = "";
    }

    if (local().isRestarting) {
        local().isRestarting = false;
        // startServerInstance only proceeds from "offline"; setting
        // "starting" here made its guard reject the restart's start half, so
        // a restart just stopped the server. Hand it an offline state and let
        // startServerInstance own the transition.
        ctx.setState({
            serverStatus: "offline",
            onlinePlayers: [],
            maxPlayers: null,
            serverEntries: appendCapped(ctx.state.serverEntries, {
                type: "info",
                content: "[Server] Restarting instance...",
            }),
        });
        void startServerInstance(ctx);
    } else {
        ctx.setState({
            serverStatus: "offline",
            onlinePlayers: [],
            maxPlayers: null,
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
                cancelStopForceKill();
                // a forced kill during a restart must still restart; the
                // old code dropped the restart on the floor here
                const wasRestarting = local().isRestarting;
                local().isRestarting = false;
                ctx.setState({
                    serverStatus: "offline",
                    maxPlayers: null,
                    serverEntries: appendCapped(ctx.state.serverEntries, {
                        type: "warn",
                        content: "[Server] Process stopped.",
                    }),
                });
                if (wasRestarting) void startServerInstance(ctx);
            }
        } catch (err) {
            clearInterval(poll);
            cancelStopForceKill();
            console.error("[gameserver] server-poll iteration failed:", String(err));
        }
    }, 500);
}
