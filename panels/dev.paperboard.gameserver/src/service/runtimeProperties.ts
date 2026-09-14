import { config, processApi, type ServiceContext } from "@paperboard-dev/paperapi";
import { PANEL_ID, SERVER_PROC_ID, type GameServerState } from "./types";

// Runtime-applicable server.properties values. Most keys (port, motd,
// world generation, max-players, ...) are only read by the JVM at startup;
// these are the ones a running server can be told to change immediately.
// `difficulty` and `gamemode` are also stored per-world in level.dat, which
// is why writing server.properties alone looked like it "did nothing".
// Console commands have always taken names, even on servers whose
// server.properties stores the legacy integers (pre-1.14): map either form
// to the name. Unknown values are refused at the boundary below.
const DIFFICULTY_NAMES: Record<string, string> = {
    "0": "peaceful",
    "1": "easy",
    "2": "normal",
    "3": "hard",
    peaceful: "peaceful",
    easy: "easy",
    normal: "normal",
    hard: "hard",
};
const GAMEMODE_NAMES: Record<string, string> = {
    "0": "survival",
    "1": "creative",
    "2": "adventure",
    "3": "spectator",
    survival: "survival",
    creative: "creative",
    adventure: "adventure",
    spectator: "spectator",
};

// one validated property write per key; bounded by the field list
const MAX_PENDING_PROPERTIES = 32;

export function runtimeCommandsFor(values: Record<string, string>): string[] {
    const commands: string[] = [];
    const difficulty = values.difficulty ? DIFFICULTY_NAMES[values.difficulty] : undefined;
    if (difficulty) {
        commands.push(`difficulty ${difficulty}`);
    }
    const gamemode = values.gamemode ? GAMEMODE_NAMES[values.gamemode] : undefined;
    if (gamemode) {
        commands.push(`defaultgamemode ${gamemode}`);
        // force-gamemode makes returning players adopt the default on join;
        // mirror that intent for players already online
        if (values["force-gamemode"] === "true") {
            commands.push(`gamemode ${gamemode} @a`);
        }
    }
    return commands;
}

// called after the Options tab writes server.properties. Online: apply the
// runtime subset now. Offline: an existing world ignores server.properties
// for difficulty/gamemode, so park the commands and replay them on boot.
export function applyRuntimeProperties(
    ctx: ServiceContext<GameServerState>,
    values: Record<string, string>,
): void {
    const commands = runtimeCommandsFor(values);
    if (commands.length === 0) return;
    if (ctx.state.serverStatus === "online") {
        for (const command of commands) {
            processApi.write(SERVER_PROC_ID, `${command}\n`);
        }
    } else {
        void persistPendingProperties(values);
    }
}

async function persistPendingProperties(values: Record<string, string>): Promise<void> {
    let saved: Record<string, unknown> = {};
    try {
        const current = await config.get<Record<string, unknown>>(PANEL_ID);
        if (current && typeof current === "object") saved = current;
    } catch (err) {
        console.debug("[Service:Properties] no saved panel config yet:", String(err));
    }
    const pending: Record<string, string> = {
        ...((saved.pendingProperties as Record<string, string> | undefined) ?? {}),
    };
    if (values.difficulty && DIFFICULTY_NAMES[values.difficulty]) {
        pending.difficulty = values.difficulty;
    }
    if (values.gamemode && GAMEMODE_NAMES[values.gamemode]) {
        pending.gamemode = values.gamemode;
        pending["force-gamemode"] = values["force-gamemode"] === "true" ? "true" : "false";
    }
    const entries = Object.entries(pending);
    if (entries.length > MAX_PENDING_PROPERTIES) {
        console.error(
            `[Service:Properties] refusing ${entries.length} pending edits (cap ${MAX_PENDING_PROPERTIES})`,
        );
        return;
    }
    await config.set({ ...saved, pendingProperties: pending }, PANEL_ID);
}

// re-applies offline runtime edits once the server reports online, then
// clears them. A later in-game change must not be clobbered by a stale
// saved value on the following boot.
export async function applyPendingRuntimeProperties(
    ctx: ServiceContext<GameServerState>,
): Promise<void> {
    let saved: Record<string, unknown> | undefined;
    try {
        saved = await config.get<Record<string, unknown>>(PANEL_ID);
    } catch (err) {
        console.error("[Service:Properties] config read failed; offline edits not applied:", err);
        return;
    }
    const pending = saved?.pendingProperties;
    if (!pending || typeof pending !== "object") return;

    // re-validate at this boundary: the config file is user-editable, and
    // these strings become console commands
    const values: Record<string, string> = {};
    const rawPending = pending as Record<string, unknown>;
    if (typeof rawPending.difficulty === "string") values.difficulty = rawPending.difficulty;
    if (typeof rawPending.gamemode === "string") values.gamemode = rawPending.gamemode;
    if (rawPending["force-gamemode"] === "true") values["force-gamemode"] = "true";

    const commands = runtimeCommandsFor(values);
    for (const command of commands) {
        processApi.write(SERVER_PROC_ID, `${command}\n`);
    }

    try {
        await config.set({ ...(saved ?? {}), pendingProperties: {} }, PANEL_ID);
    } catch (err) {
        console.error("[Service:Properties] clearing applied edits failed:", err);
    }
}
