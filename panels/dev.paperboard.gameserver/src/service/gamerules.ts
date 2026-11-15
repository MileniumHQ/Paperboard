import type { Server } from "./server";
import { minecraftSoftware } from "../games/minecraft/index";

import {
    assertGameruleName,
    assertGameruleValue,
    isKnownGameruleName,
    mergeGameruleValue,
} from "../core/gamerules";
import {
    resolveVersionProfile,
    serverGameruleName,
    serverGameruleValue,
    type VersionProfile,
} from "../lib/versionProfile";
import { SERVER_PROC_ID } from "./types";
import { applyPendingEdits } from "./pendingEdits";

// gamerule truth comes from the running server, not from registry
// defaults: query responses ("is currently set to") and write
// confirmations ("is now set to") are parsed in lifecycle.handleProcessData
// and merged into state.gamerules, which syncs to the UI through the bridge.

// one write per pending edit; bounded by the registry the UI queries from
const MAX_GAMERULE_WRITES = 100;

// pre-1.21.11 servers spell gamerules in camelCase and invert the `disable*`
// rules; every console write and query is translated through the profile.
function profileFor(ctx: Server): VersionProfile {
    return resolveVersionProfile(minecraftSoftware(ctx.state.serverSoftware), ctx.state.serverVersion);
}

export async function setGamerule(
    ctx: Server,
    rawName: string,
    rawValue: string,
): Promise<boolean> {
    const name = assertGameruleName(rawName);
    const value = assertGameruleValue(name, rawValue);
    const profile = profileFor(ctx);
    const serverName = serverGameruleName(profile, name);
    const serverValue = serverGameruleValue(profile, name, value);

    if (ctx.state.serverStatus === "online") {
        // a write the console refused fails the call: no readout would ever correct it
        await ctx.process.write(SERVER_PROC_ID, `gamerule ${serverName} ${serverValue}\n`);
    } else {
        // offline edits must never look applied-and-dropped: they persist
        // in panel config and re-apply the next time the server boots, and
        // an edit that could not be saved fails the call that made it
        await persistPendingGamerule(ctx, name, value);
    }

    // optimistic truth until the server's readout corrects it
    ctx.setState((prev) => ({
        gamerules: mergeGameruleValue(prev.gamerules, name, value),
    }));
    return true;
}

async function persistPendingGamerule(ctx: Server, name: string, value: string): Promise<void> {
    await ctx.updateSettings((saved) => ({
        ...saved,
        pendingGamerules: { ...((saved.pendingGamerules as Record<string, string> | undefined) ?? {}), [name]: value },
    }));
}

// reads current values from the running server — one query per rule,
// written directly to the console (like the stat queries) so the console
// view is not flooded with command entries. The UI supplies the names it
// displays (version-filtered); every name is re-validated here.
export async function queryGamerules(
    ctx: Server,
    names: string[],
): Promise<boolean> {
    if (ctx.state.serverStatus !== "online") return false;
    const profile = profileFor(ctx);
    const known = names.filter(isKnownGameruleName).slice(0, MAX_GAMERULE_WRITES);
    // the tab waits on these readouts: a write the console refused fails the call
    for (const name of known) {
        await ctx.process.write(SERVER_PROC_ID, `gamerule ${serverGameruleName(profile, name)}\n`);
    }
    return true;
}

/** Sends the gamerule edits made while the server was offline; throws why they were not. */
export function applyPendingGamerules(ctx: Server): Promise<void> {
    const profile = profileFor(ctx);
    return applyPendingEdits(ctx, "pendingGamerules", (pending) => {
        const entries = Object.entries(pending);
        if (entries.length > MAX_GAMERULE_WRITES) throw new Error(`${entries.length} saved gamerule edits is more than the ${MAX_GAMERULE_WRITES} a boot sends`);
        return entries.map(([name, value]) => {
            const safeName = assertGameruleName(name);
            const safeValue = assertGameruleValue(safeName, String(value));
            return `gamerule ${serverGameruleName(profile, safeName)} ${serverGameruleValue(profile, safeName, safeValue)}`;
        });
    });
}

