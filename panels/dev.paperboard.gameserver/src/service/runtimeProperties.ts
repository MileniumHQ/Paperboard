import type { Server } from "./server";
import { processApi, updateSettings } from "./api";
import { PANEL_ID, SERVER_PROC_ID, type GameServerState } from "./types";
import { applyPendingEdits } from "./pendingEdits";

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
export async function applyRuntimeProperties(
    ctx: Server,
    values: Record<string, string>,
): Promise<void> {
    const commands = runtimeCommandsFor(values);
    if (commands.length === 0) return;
    if (ctx.state.serverStatus === "online") {
        for (const command of commands) {
            await processApi.write(SERVER_PROC_ID, `${command}\n`);
        }
    } else {
        await persistPendingProperties(values);
    }
}

// a missing config reads as null; a read that throws is unreadable state,
// so the error propagates instead of overwriting the config with {}
async function persistPendingProperties(values: Record<string, string>): Promise<void> {
    await updateSettings((saved) => {
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
        throw new Error(
            `refusing ${entries.length} pending property edits (cap ${MAX_PENDING_PROPERTIES})`,
        );
    }
    return { ...saved, pendingProperties: pending };
    });
}

/** Sends the property edits made while the server was offline; throws why they were not. */
export function applyPendingRuntimeProperties(): Promise<void> {
    return applyPendingEdits("pendingProperties", (pending) => {
        const values: Record<string, string> = {};
        if (typeof pending.difficulty === "string") values.difficulty = pending.difficulty;
        if (typeof pending.gamemode === "string") values.gamemode = pending.gamemode;
        if (pending["force-gamemode"] === "true") values["force-gamemode"] = "true";
        return runtimeCommandsFor(values);
    });
}
