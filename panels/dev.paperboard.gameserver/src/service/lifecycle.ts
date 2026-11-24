import type { Server } from "./server";
import { errorMessage } from "@mileniumhq/paperapi";
import { assertRecoverySettled } from "./recoveryState";
import { prepareGamePorts } from "./ports";
import { livePortDeps } from "./portDeps";
import { type GameServerState, appendCapped, MAX_BUFFERED_ENTRIES } from "./types";
import { loadServerOptions } from "./options";
import { oomKillCount } from "./memory";
import { TRIGGER_IDS } from "./contract";
import { report } from "../games/serviceKit";
import { afterCrash, cancelStopRequest, classifyExit, markStarting, markStopRequested, updateBeforeStart } from "./automation";

export function cancelReadiness(ctx: Server): void {
    const local = ctx.lifecycle;
    local.generation++;
    if (local.readinessTimer) clearTimeout(local.readinessTimer);
    local.readinessTimer = null;
    if (local.readinessDeadline) clearTimeout(local.readinessDeadline);
    local.readinessDeadline = null;
}
function monitorReadiness(ctx: Server): void {
    cancelReadiness(ctx);
    const readiness = ctx.game.readiness;
    if (!readiness) return;
    const generation = ctx.lifecycle.generation;
    const deadline = Date.now() + readiness.timeoutMs;
    // A separate deadline enforces the bound even if a probe hangs.
    const expired = setTimeout(() => void fail(new Error(`Startup timed out after ${readiness.timeoutMs / 1000}s; inspect the preceding ${ctx.definition.name} logs`)), readiness.timeoutMs);
    ctx.lifecycle.readinessDeadline = expired;
    expired.unref?.();
    const active = () => generation === ctx.lifecycle.generation && ctx.state.serverStatus === "starting";
    const fail = async (err: unknown) => {
        if (!active()) return;
        clearTimeout(expired); cancelReadiness(ctx);
        ctx.setState({ serverEntries: appendCapped(ctx.state.serverEntries, { type: "error", content: `Startup failed: ${errorMessage(err)}` }) });
        markStopRequested(ctx);
        // nobody awaits this: a kill that fails is said, or the server would sit "starting" in silence
        await ctx.process.kill(ctx.game.primaryProcessId, "SIGKILL").catch((killErr) => report(ctx, "The server that failed to start could not be ended", killErr));
    };
    const poll = async () => {
        if (!active()) { clearTimeout(expired); return; }
        try {
            if (Date.now() >= deadline) throw new Error("Startup deadline exceeded");
            const ready = await readiness.probe();
            if (!active()) { clearTimeout(expired); return; }
            if (ready) { clearTimeout(expired); cancelReadiness(ctx); ctx.setState({ serverStatus: "online" }); ctx.trigger(TRIGGER_IDS.serverStarted, true); return; }
            ctx.lifecycle.readinessTimer = setTimeout(() => void poll(), 100);
            ctx.lifecycle.readinessTimer?.unref?.();
        } catch (err) { await fail(err); }
    };
    void poll();
}

function cancelStopForceKill(ctx: Server): void {
    const local = ctx.lifecycle;
    if (local.stopTimeout) clearTimeout(local.stopTimeout);
    local.stopTimeout = null;
    if (local.killDeadline) clearTimeout(local.killDeadline);
    local.killDeadline = null;
}

// exactly one pending force-kill at a time: a stop/restart issued while a
// previous force-kill is pending cancels and reschedules instead of
// stacking a second timer. The timers are unref'd so a pending kill never
// holds the service process open.
function scheduleStopForceKill(
    ctx: Server,
    delayMs: number = 15000,
    confirmMs: number = 10000,
): void {
    cancelStopForceKill(ctx);
    const timer = setTimeout(() => {
        ctx.lifecycle.stopTimeout = null;
        if (ctx.game.stopTimeoutMs) ctx.setState({ serverEntries: appendCapped(ctx.state.serverEntries, { type: "error", content: "[Server] Graceful stop timed out; force-killing. World save not confirmed." }) });
        void Promise.resolve(ctx.process.kill(ctx.game.primaryProcessId, "SIGKILL")).catch((err) => ctx.setState((prev) => ({ serverEntries: appendCapped(prev.serverEntries, { type: "error", content: `[Server] Force-kill failed: ${errorMessage(err)}` }) })));
        const deadline = setTimeout(() => void confirmForceKill(ctx), confirmMs);
        deadline.unref?.();
        ctx.lifecycle.killDeadline = deadline;
    }, delayMs);
    timer.unref?.();
    ctx.lifecycle.stopTimeout = timer;
}

/**
 * The exit event ends a force-kill (handleProcessExit clears this deadline).
 * When none came in time, the process is asked for: gone means the exit was
 * missed and is handled now; still there is said, and the server is online
 * again so Stop can be pressed again. Offline is never written over a live
 * process.
 */
async function confirmForceKill(ctx: Server): Promise<void> {
    ctx.lifecycle.killDeadline = null;
    let reason: string;
    try {
        if (!(await ctx.process.exists(ctx.game.primaryProcessId))) return handleProcessExit(ctx);
        reason = "the process is still running";
    } catch (err) {
        reason = errorMessage(err);
    }
    ctx.lifecycle.isRestarting = false;
    cancelStopRequest(ctx);
    ctx.setState((prev) => ({ serverStatus: "online", serverEntries: appendCapped(prev.serverEntries, { type: "error", content: `[Server] Could not confirm the force-kill: ${reason}.` }) }));
}

// test seam: the force-kill is time-based, so tests drive it with short
// delays, and its confirmation directly, instead of waiting out the real windows
export const __lifecycleTest = {
    scheduleStopForceKill,
    confirmForceKill,
    isStopForceKillPending: (ctx: Server) => ctx.lifecycle.stopTimeout !== null || ctx.lifecycle.killDeadline !== null,
};

/**
 * Tells the game its server's process is gone, and which of that run's ports
 * moved off taken ones. A failure is shown in the console, never dropped;
 * undefined when the game has nothing to take back.
 */
export function releaseServer(ctx: Server, moves: GameServerState["portMoves"]): Promise<void> | undefined {
    const afterStop = ctx.game.afterStop;
    if (!afterStop) return undefined;
    return (ctx.lifecycle.released = afterStop(moves).catch((err) => {
        console.error("[gameserver] cleaning up after the server stopped failed:", err);
        ctx.setState((prev) => ({
            serverEntries: appendCapped(prev.serverEntries, {
                type: "error",
                content: `[Server] Could not clean up after the server stopped: ${errorMessage(err)}`,
            }),
        }));
    }));
}

/** The system's count of programs it ended for memory, or null where it keeps none; a count it can't read is said. */
function readOomKills(ctx: Server): number | null {
    try {
        return oomKillCount();
    } catch (err) {
        ctx.setState((prev) => ({ serverEntries: appendCapped(prev.serverEntries, { type: "warn", content: `[Server] Could not read the system's memory events, so a crash from running out of memory is not told apart: ${errorMessage(err)}` }) }));
        return null;
    }
}

function refuseIfHeld(ctx: Server): void {
    if (ctx.backupHold) throw new Error(ctx.backupHold === "backup" ? "The server's files are being backed up; start it once the copy is made" : "A backup is being restored; start the server once it is in place");
}

/** `carry`: lines the fresh console opens with, as why the server is starting again. */
export async function startServerInstance(
    ctx: Server,
    carry: GameServerState["serverEntries"] = [],
): Promise<void> {
    // a start already under way is this one: it ends, or fails, with it
    if (ctx.lifecycle.starting) return ctx.lifecycle.starting;
    if (ctx.state.serverStatus !== "offline") return;
    // the last run's cleanup puts back files this start reads
    await ctx.lifecycle.released;
    if (ctx.lifecycle.starting) return ctx.lifecycle.starting;
    if (ctx.state.serverStatus !== "offline") return;
    // refused to the caller, and said in the console for the restarts that
    // have none: a half-settled server folder is not a launch failure
    try {
        assertRecoverySettled(ctx, "starting the server");
        refuseIfHeld(ctx);
    }
    catch (err) { report(ctx, "The server was not started", err); throw err; }
    // from here, with no await before it, a backup or restore waits for this start
    const starting = launchServer(ctx, carry);
    ctx.lifecycle.starting = starting;
    try {
        await starting;
    } finally {
        if (ctx.lifecycle.starting === starting) ctx.lifecycle.starting = null;
    }
}

async function launchServer(ctx: Server, carry: GameServerState["serverEntries"]): Promise<void> {
    try {
        ctx.setState({ activeIssue: null });
        await loadServerOptions(ctx);

        const game = ctx.game;
        const support = ctx.definition.hostSupport({ os: process.platform, arch: process.arch }, { software: ctx.state.serverSoftware, version: ctx.state.serverVersion, settings: ctx.state.gameSettings });
        if (!support.supported) throw new Error(support.reason ?? "Unsupported host");

        // the port files are the install's while one runs
        if (ctx.game.isMutating()) {
            throw new Error("A server install is running; start the server once it finishes.");
        }
        // throws, with who has it, when a port is taken and the user's
        // setting refuses to move it
        const { ports, moves } = await prepareGamePorts(game.ports(livePortDeps(ctx)), livePortDeps(ctx));
        ctx.runPorts = ports;

        // the update installs before the launch reads the server's files; it
        // holds the game's install flag, so a second start refuses meanwhile
        await updateBeforeStart(ctx);
        const launch = await game.prepareLaunch();

        // an install owns the server folder until it activates or rolls
        // back. Checked with no await before the status flips: the install
        // action likewise checks "offline" and claims the folder in one
        // synchronous step, so the two can never both proceed.
        if (ctx.game.isMutating()) {
            throw new Error("A server install is running; start the server once it finishes.");
        }
        // a backup or restore that began while this start prepared has the folder now
        refuseIfHeld(ctx);
        // the last run's console and chat stay above the new one: they are
        // what a crash, or the players before it, said. An update before the
        // start has already said its lines into it.
        ctx.setState({
            serverStatus: "starting",
            portMoves: moves,
            serverEntries: [
                ...ctx.state.serverEntries,
                ...carry,
                {
                    type: "info" as const,
                    content: launch.message,
                },
                ...moves.map((move) => ({
                    type: "warn" as const,
                    content: `[Server] Port ${move.from} was taken, so this run of ${move.label} uses ${move.to}.`,
                })),
            ].slice(-MAX_BUFFERED_ENTRIES),
        });

        markStarting(ctx);
        ctx.lifecycle.oomBaseline = readOomKills(ctx);
        await ctx.process.start({
            id: ctx.game.primaryProcessId,
            command: launch.command.executable,
            args: launch.command.args,
            cwd: launch.command.cwd,
            env: launch.command.env,
            inputEncoding: launch.command.inputEncoding,
            consoleInput: launch.command.consoleInput,
            // people play on it: an update of its runtime waits for it
            important: true,
        });
        monitorReadiness(ctx);
    } catch (err) {
        console.error("[Service:Lifecycle] Failed to start server:", err);
        // the launch may have got as far as preparing the server's files
        void releaseServer(ctx, ctx.state.portMoves);
        ctx.setState({
            serverStatus: "offline",
            serverEntries: appendCapped(ctx.state.serverEntries, {
                type: "error",
                content: `[Server] Failed to launch: ${errorMessage(err)}`,
            }),
        });
        throw err;
    }
}

export async function stopServerInstance(
    ctx: Server,
): Promise<void> {
    cancelReadiness(ctx);
    const curr = ctx.state.serverStatus;
    if (curr === "starting") {
        markStopRequested(ctx);
        await ctx.process.kill(ctx.game.primaryProcessId, "SIGKILL");
        ctx.setState({
            serverStatus: "offline",
            serverEntries: appendCapped(ctx.state.serverEntries, {
                type: "warn",
                content: "[Server] Process killed by user.",
            }),
        });
    } else if (curr === "online") {
        markStopRequested(ctx);
        ctx.setState({
            serverStatus: "stopping",
            serverEntries: appendCapped(ctx.state.serverEntries, {
                type: "command",
                content: ctx.game.stopEntry,
            }),
        });
        try { await ctx.game.stop(); }
        catch (err) { cancelStopRequest(ctx); ctx.setState({ serverStatus: "online" }); throw err; }

        scheduleStopForceKill(ctx, ctx.game.stopTimeoutMs);
    }
}

export async function restartServerInstance(
    ctx: Server,
): Promise<void> {
    if (ctx.state.serverStatus !== "online") return;
    cancelReadiness(ctx);
    ctx.lifecycle.isRestarting = true;
    markStopRequested(ctx);
    ctx.setState({
        serverStatus: "restarting",
        serverEntries: appendCapped(
            appendCapped(ctx.state.serverEntries, {
                type: "command",
                content: ctx.game.stopEntry,
            }),
            {
                type: "info",
                content: "[Server] Stopping for restart...",
            },
        ),
    });
    try { await ctx.game.stop(); }
    catch (err) { ctx.lifecycle.isRestarting = false; cancelStopRequest(ctx); ctx.setState({ serverStatus: "online" }); throw err; }

    scheduleStopForceKill(ctx, ctx.game.stopTimeoutMs);
}

export async function sendServerCommand(
    ctx: Server,
    cmd: string,
): Promise<void> {
    // every console write passes this boundary: a multi-line value is a
    // second console command injected through the same write. call-site
    // validation (kick/ban reasons) does not replace this check — it is
    // the last line of defense for raw-command callers too, matching
    // sendChatMessage's discipline one action over.
    const game = ctx.game;
    const control = ctx.definition.describe({ software: ctx.state.serverSoftware, version: ctx.state.serverVersion, settings: ctx.state.gameSettings }).control.kind;
    if (control !== "stdin" && control !== "rcon")
        throw new Error("This game does not support console commands");
    if (control === "rcon" && !game.sendCommand) throw new Error(`${ctx.definition.name} declares a remote console but has no way to send to it`);
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
        if (control === "rcon") await game.sendCommand!(line);
        else await ctx.process.write(ctx.game.primaryProcessId, line);
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
export function handleProcessData(ctx: Server, chunk: string): void {
    ctx.lifecycle.lineBuffer += chunk;
    const lines = ctx.lifecycle.lineBuffer.split("\n");
    ctx.lifecycle.lineBuffer = lines.pop() ?? "";
    for (const line of lines) ctx.game.observeLine(line);
    if (ctx.lifecycle.lineBuffer) ctx.game.observePartialLine?.(ctx.lifecycle.lineBuffer);
}
export function sendChatMessage(ctx: Server, msg: string): Promise<void> {
    const game = ctx.game;
    if (!game.sendChat) throw new Error("This game does not support chat");
    return game.sendChat(msg);
}

export function handleProcessExit(ctx: Server, exitCode?: number): void {
    cancelStopForceKill(ctx);
    cancelReadiness(ctx);

    if (ctx.lifecycle.lineBuffer.trim()) {
        ctx.game.observeLine(ctx.lifecycle.lineBuffer, true);
        ctx.lifecycle.lineBuffer = "";
    }
    // the run's moves end with it as it goes offline; the game is told them
    const moves = ctx.state.portMoves;

    if (ctx.lifecycle.isRestarting) {
        ctx.lifecycle.isRestarting = false;
        // startServerInstance only proceeds from "offline" and owns the
        // transition to "starting"
        ctx.setState({
            serverStatus: "offline",
            onlinePlayers: [],
            maxPlayers: null,
            serverLevel: null,
            serverEntries: appendCapped(ctx.state.serverEntries, {
                type: "info",
                content: "[Server] Restarting instance...",
            }),
        });
        // the game takes back what the last start set aside before the next one sets it again
        // quiet: startServerInstance puts its own failure in the console
        const restart = () => void startServerInstance(ctx).catch(err => console.error("[gameserver] restart failed:", err));
        const released = releaseServer(ctx, moves);
        if (released) void released.then(restart);
        else restart();
    } else {
        const exit = classifyExit(ctx, exitCode);
        const released = releaseServer(ctx, moves);
        ctx.setState({
            serverStatus: "offline",
            onlinePlayers: [],
            maxPlayers: null,
            serverLevel: null,
            serverEntries: appendCapped(ctx.state.serverEntries, {
                type: "warn",
                content: "[Server] Process stopped.",
            }),
        });
        ctx.trigger(TRIGGER_IDS.serverStopped, true);
        if (exit.kind === "crashed") {
            ctx.trigger(TRIGGER_IDS.serverCrashed, exitCode ?? null);
            // SIGKILL, while the system's count of programs it ended for
            // memory went up: the system ran out and chose the server
            const baseline = ctx.lifecycle.oomBaseline;
            const outOfMemory = exitCode === 137 && baseline !== null && (readOomKills(ctx) ?? baseline) > baseline;
            // the game takes back what the crashed start set aside before the next one
            afterCrash(ctx, { whileStarting: exit.whileStarting, exitCode, outOfMemory }, (ctx, carry) => (released ?? Promise.resolve()).then(() => startServerInstance(ctx, carry)));
        }
    }
}
