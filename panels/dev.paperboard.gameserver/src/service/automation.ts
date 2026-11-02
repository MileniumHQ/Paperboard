import { config, type ServiceContext } from "./api";
import { serverLocal } from "./scope";
import { currentGameService } from "../games/service";
import { appendCapped, type GameServerState, PANEL_ID } from "./types";

/** What the server does on its own: restart after a crash, once a day at a set hour, and update itself. */
export interface AutomationSettings {
    restartAfterCrash: boolean;
    /** "HH:00" on the computer's clock, or null for no daily restart */
    dailyRestart: string | null;
    /** install a newer build before each start, and restart a running server for one; games that can update themselves */
    autoUpdate: boolean;
}
export interface AutomationView extends AutomationSettings {
    /** the computer's time zone, which the daily restart hour is on */
    timeZone: string;
    /** whether the game can update itself, so autoUpdate means something */
    canUpdate: boolean;
}

const KEY = "automation";
export const AUTOMATION_DEFAULTS: AutomationSettings = { restartAfterCrash: true, dailyRestart: null, autoUpdate: true };
/** Crashes inside the window that stop the automatic restarts: a server that keeps crashing needs a person. */
export const CRASH_LIMIT = 3;
export const CRASH_WINDOW_MS = 10 * 60_000;
export const CRASH_RESTART_DELAY_MS = 5_000;
/** Minutes before a daily restart that players are told it is coming. */
export const RESTART_WARNINGS = [5, 1] as const;
/** How often a running server asks whether an update is out, and how long players get before it restarts for one. */
export const UPDATE_CHECK_MS = 60 * 60_000;
export const UPDATE_WARNING_MS = 5 * 60_000;
const HOUR = /^([01]\d|2[0-3]):00$/;

const local = serverLocal(() => ({
    settings: null as AutomationSettings | null,
    crashes: [] as number[],
    stopRequested: false,
    crashReported: false,
    crashTimer: null as ReturnType<typeof setTimeout> | null,
    dailyTimers: [] as ReturnType<typeof setTimeout>[],
    updateTimer: null as ReturnType<typeof setTimeout> | null,
}));

export function parseAutomation(raw: unknown): AutomationSettings {
    if (raw === undefined || raw === null) return { ...AUTOMATION_DEFAULTS };
    if (typeof raw !== "object") throw new Error("The saved automation settings are not an object");
    return validateAutomation({ ...AUTOMATION_DEFAULTS, ...(raw as Record<string, unknown>) });
}

export function validateAutomation(input: Record<string, unknown>): AutomationSettings {
    const { restartAfterCrash, dailyRestart, autoUpdate } = input;
    if (typeof restartAfterCrash !== "boolean") throw new Error("Restart after a crash must be on or off");
    if (dailyRestart !== null && (typeof dailyRestart !== "string" || !HOUR.test(dailyRestart))) throw new Error("The daily restart must be a whole hour, as 04:00");
    if (typeof autoUpdate !== "boolean") throw new Error("Update automatically must be on or off");
    return { restartAfterCrash, dailyRestart, autoUpdate };
}

export async function readAutomation(): Promise<AutomationSettings> {
    const saved = await config.get<Record<string, unknown>>(PANEL_ID);
    const settings = parseAutomation(saved?.[KEY]);
    local().settings = settings;
    return settings;
}

export function automationView(settings: AutomationSettings): AutomationView {
    const game = currentGameService();
    return { ...settings, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, canUpdate: Boolean(game.updateStatus && game.installUpdate) };
}

export async function writeAutomation(ctx: ServiceContext<GameServerState>, patch: Record<string, unknown>, restart: (ctx: ServiceContext<GameServerState>) => Promise<void>): Promise<AutomationSettings> {
    const next = validateAutomation({ ...(await readAutomation()), ...patch });
    const saved = (await config.get<Record<string, unknown>>(PANEL_ID)) ?? {};
    await config.set({ ...saved, [KEY]: next }, PANEL_ID);
    local().settings = next;
    // a changed setting starts a fresh count: the user is looking at the server
    local().crashes = [];
    scheduleDailyRestart(ctx, restart);
    scheduleUpdateChecks(ctx, restart);
    return next;
}

/** Paperboard asked the server to stop, so its exit is not a crash. */
export function markStopRequested(): void { local().stopRequested = true; }
/** The stop request never reached the server, which keeps running. */
export function cancelStopRequest(): void { local().stopRequested = false; }
/** A start clears what the last run left behind. */
export function markStarting(): void { local().stopRequested = false; local().crashReported = false; }
/** The game's output said it crashed, as Minecraft's crash report; its exit code may still be 0. */
export function noteCrashReport(): void { local().crashReported = true; }

export type ExitKind = { kind: "stopped" } | { kind: "crashed"; whileStarting: boolean };

/** Whether an exit was a stop or a crash: a crash is an exit nobody asked for, with an error code or a crash report. */
export function classifyExit(status: GameServerState["serverStatus"], exitCode: number | undefined): ExitKind {
    const { stopRequested: requested, crashReported } = local();
    // an exit settles both: the next run starts clean
    local().stopRequested = false;
    local().crashReported = false;
    if (requested || status === "offline") return { kind: "stopped" };
    const failed = (exitCode !== undefined && exitCode !== 0) || crashReported;
    if (!failed) return { kind: "stopped" };
    return { kind: "crashed", whileStarting: status === "starting" };
}

/** An exit code as people look it up: Windows crash statuses (0xC0000005) are read in hex, everything else in decimal. */
function describeExitCode(code: number): string {
    return code < 0 || code > 0x7fffffff ? `0x${(code >>> 0).toString(16).toUpperCase()}` : String(code);
}

/**
 * Restarts a server that crashed while running, unless it has crashed
 * CRASH_LIMIT times inside CRASH_WINDOW_MS. A crash while starting never
 * restarts: the next start fails the same way. Says in the console either way.
 */
export function afterCrash(ctx: ServiceContext<GameServerState>, exit: { whileStarting: boolean; exitCode: number | undefined; outOfMemory?: boolean }, start: (ctx: ServiceContext<GameServerState>, carry: GameServerState["serverEntries"]) => Promise<void>, now = Date.now()): void {
    const code = exit.exitCode === undefined ? "" : ` (exit code ${describeExitCode(exit.exitCode)})`;
    const say = (type: "error" | "warn" | "info", content: string) => ctx.setState((prev) => ({ serverEntries: appendCapped(prev.serverEntries, { type, content }) }));
    if (exit.outOfMemory) say("error", `[Server] The computer ran out of memory, so the system ended the server${exit.whileStarting ? " while it was starting" : ""}${code}. Give the server less memory or close other programs.`);
    else say("error", `[Server] The server crashed${exit.whileStarting ? " while starting" : ""}${code}. Logs has what it printed.`);
    if (exit.whileStarting) return;
    const settings = local().settings ?? AUTOMATION_DEFAULTS;
    if (!settings.restartAfterCrash) return;
    const crashes = [...local().crashes.filter((at) => now - at < CRASH_WINDOW_MS), now];
    local().crashes = crashes;
    if (crashes.length >= CRASH_LIMIT) {
        say("error", `[Server] It crashed ${crashes.length} times in ${CRASH_WINDOW_MS / 60_000} minutes, so it was not restarted. Start it once the cause is fixed.`);
        local().crashes = [];
        return;
    }
    say("info", `[Server] Restarting in ${CRASH_RESTART_DELAY_MS / 1000} seconds.`);
    if (local().crashTimer) clearTimeout(local().crashTimer!);
    const timer = setTimeout(() => {
        local().crashTimer = null;
        if (ctx.state.serverStatus !== "offline") return;
        // the fresh console still says why the server started again
        const when = new Date(now).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
        start(ctx, [{ type: "warn", content: `[Server] Restarted after a crash at ${when}${code}.` }]).catch((err) => say("error", `[Server] Restart after the crash failed: ${err instanceof Error ? err.message : String(err)}`));
    }, CRASH_RESTART_DELAY_MS);
    timer.unref?.();
    local().crashTimer = timer;
}

/** Milliseconds from `now` to the next "HH:00" on this computer's clock. */
export function msUntilHour(hour: string, now: Date): number {
    const next = new Date(now);
    next.setHours(Number(hour.slice(0, 2)), 0, 0, 0);
    if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
    return next.getTime() - now.getTime();
}

function cancelDailyRestart(): void {
    for (const timer of local().dailyTimers) clearTimeout(timer);
    local().dailyTimers = [];
}

/** Drops every pending automatic restart, as when the server is removed. */
export function cancelAutomation(): void {
    cancelDailyRestart();
    if (local().updateTimer) clearTimeout(local().updateTimer!);
    local().updateTimer = null;
    if (local().crashTimer) clearTimeout(local().crashTimer!);
    local().crashTimer = null;
}

/**
 * Arms the daily restart: players are warned RESTART_WARNINGS minutes ahead,
 * then a running server restarts. A server that is not running is left alone.
 */
export function scheduleDailyRestart(ctx: ServiceContext<GameServerState>, restart: (ctx: ServiceContext<GameServerState>) => Promise<void>, now = new Date()): void {
    cancelDailyRestart();
    const hour = local().settings?.dailyRestart;
    if (!hour) return;
    const due = msUntilHour(hour, now);
    const say = (type: "error" | "info", content: string) => ctx.setState((prev) => ({ serverEntries: appendCapped(prev.serverEntries, { type, content }) }));
    const at = (ms: number, work: () => Promise<void>) => {
        if (ms < 0) return;
        const timer = setTimeout(() => {
            local().dailyTimers = local().dailyTimers.filter((t) => t !== timer);
            void work();
        }, ms);
        timer.unref?.();
        local().dailyTimers.push(timer);
    };
    for (const minutes of RESTART_WARNINGS) {
        at(due - minutes * 60_000, async () => {
            const sendChat = currentGameService().sendChat;
            if (ctx.state.serverStatus !== "online" || !sendChat || ctx.state.onlinePlayers.length === 0) return;
            await sendChat(ctx, `The server restarts in ${minutes} minute${minutes === 1 ? "" : "s"}.`)
                .catch((err) => say("error", `[Server] Could not warn players about the daily restart: ${err instanceof Error ? err.message : String(err)}`));
        });
    }
    at(due, async () => {
        // the next day's restart is armed before this one runs
        scheduleDailyRestart(ctx, restart, new Date(Date.now() + 1000));
        if (ctx.state.serverStatus !== "online") return;
        say("info", "[Server] Daily restart.");
        await restart(ctx).catch((err) => say("error", `[Server] The daily restart failed: ${err instanceof Error ? err.message : String(err)}`));
    });
}

type Say = (type: "error" | "warn" | "info", content: string) => void;
const consoleSay = (ctx: ServiceContext<GameServerState>): Say => (type, content) => ctx.setState((prev) => ({ serverEntries: appendCapped(prev.serverEntries, { type, content }) }));

/**
 * Before a start, installs a newer build when the game can update itself and
 * the setting is on. A check Steam can't answer is said and the server starts
 * as it is; a failed install fails the start. Gives the lines it said, for the
 * fresh console.
 */
export async function updateBeforeStart(ctx: ServiceContext<GameServerState>): Promise<GameServerState["serverEntries"]> {
    const game = currentGameService();
    if (!game.updateStatus || !game.installUpdate) return [];
    const settings = local().settings ?? await readAutomation();
    if (!settings.autoUpdate) return [];
    const said: GameServerState["serverEntries"] = [];
    const say: Say = (type, content) => { said.push({ type, content }); consoleSay(ctx)(type, content); };
    let status;
    try {
        status = await game.updateStatus(ctx);
    } catch (err) {
        say("error", `[Server] Could not check for an update, so the server starts as it is: ${err instanceof Error ? err.message : String(err)}`);
        return said;
    }
    if (!status.updateAvailable) return said;
    say("info", `[Server] Updating to build ${status.latest} before starting.`);
    await game.installUpdate(ctx);
    say("info", `[Server] Updated to build ${status.latest}.`);
    return said;
}

/**
 * Asks every UPDATE_CHECK_MS whether an update is out for a running server.
 * When one is, an empty server restarts for it at once; players get
 * UPDATE_WARNING_MS of warning first. The restart's start installs it.
 */
export function scheduleUpdateChecks(ctx: ServiceContext<GameServerState>, restart: (ctx: ServiceContext<GameServerState>) => Promise<void>, every = UPDATE_CHECK_MS): void {
    if (local().updateTimer) clearTimeout(local().updateTimer!);
    local().updateTimer = null;
    const game = currentGameService();
    if (!game.updateStatus || !game.installUpdate || !(local().settings ?? AUTOMATION_DEFAULTS).autoUpdate) return;
    const say = consoleSay(ctx);
    const arm = (ms: number, work: () => Promise<void>) => {
        const timer = setTimeout(() => { local().updateTimer = null; void work(); }, ms);
        timer.unref?.();
        local().updateTimer = timer;
    };
    const restartForUpdate = async () => {
        if (ctx.state.serverStatus !== "online") return scheduleUpdateChecks(ctx, restart, every);
        say("info", "[Server] Restarting to install an update.");
        await restart(ctx).catch((err) => say("error", `[Server] The restart for an update failed: ${err instanceof Error ? err.message : String(err)}`));
        scheduleUpdateChecks(ctx, restart, every);
    };
    arm(every, async () => {
        if (ctx.state.serverStatus !== "online") return scheduleUpdateChecks(ctx, restart, every);
        let status;
        try {
            status = await game.updateStatus!(ctx);
        } catch (err) {
            say("error", `[Server] Could not check for an update: ${err instanceof Error ? err.message : String(err)}`);
            return scheduleUpdateChecks(ctx, restart, every);
        }
        if (!status.updateAvailable) return scheduleUpdateChecks(ctx, restart, every);
        say("info", `[Server] Build ${status.latest} is out.`);
        if (ctx.state.onlinePlayers.length === 0) return restartForUpdate();
        const minutes = UPDATE_WARNING_MS / 60_000;
        await game.sendChat?.(ctx, `An update is out. The server restarts to install it in ${minutes} minute${minutes === 1 ? "" : "s"}.`)
            .catch((err) => say("error", `[Server] Could not warn players about the update: ${err instanceof Error ? err.message : String(err)}`));
        arm(UPDATE_WARNING_MS, restartForUpdate);
    });
}
