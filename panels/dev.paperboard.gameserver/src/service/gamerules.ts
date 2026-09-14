import { config, processApi, type ServiceContext } from "@paperboard-dev/paperapi";
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
import { PANEL_ID, SERVER_PROC_ID, type GameServerState } from "./types";

// gamerule truth comes from the running server, not from registry
// defaults: query responses ("is currently set to") and write
// confirmations ("is now set to") are parsed in lifecycle.handleProcessData
// and merged into state.gamerules, which syncs to the UI through the bridge.

// one write per pending edit; bounded by the registry the UI queries from
const MAX_GAMERULE_WRITES = 100;

// pre-1.21.11 servers spell gamerules in camelCase and invert the `disable*`
// rules; every console write and query is translated through the profile.
function profileFor(ctx: ServiceContext<GameServerState>): VersionProfile {
    return resolveVersionProfile(ctx.state.serverSoftware, ctx.state.serverVersion);
}

export function setGamerule(
    ctx: ServiceContext<GameServerState>,
    rawName: string,
    rawValue: string,
): boolean {
    const name = assertGameruleName(rawName);
    const value = assertGameruleValue(name, rawValue);
    const profile = profileFor(ctx);
    const serverName = serverGameruleName(profile, name);
    const serverValue = serverGameruleValue(profile, name, value);

    if (ctx.state.serverStatus === "online") {
        processApi.write(SERVER_PROC_ID, `gamerule ${serverName} ${serverValue}\n`);
    } else {
        // offline edits must never look applied-and-dropped: they persist
        // in panel config and re-apply the next time the server boots
        void persistPendingGamerule(name, value);
    }

    // optimistic truth until the server's readout corrects it
    ctx.setState((prev) => ({
        gamerules: mergeGameruleValue(prev.gamerules, name, value),
    }));
    return true;
}

async function persistPendingGamerule(name: string, value: string): Promise<void> {
    let saved: Record<string, unknown> = {};
    try {
        const current = await config.get<Record<string, unknown>>(PANEL_ID);
        if (current && typeof current === "object") saved = current;
    } catch (err) {
        console.debug("[Service:Gamerules] no saved panel config yet:", String(err));
    }
    const pending = {
        ...((saved.pendingGamerules as Record<string, string> | undefined) ?? {}),
        [name]: value,
    };
    await config.set({ ...saved, pendingGamerules: pending }, PANEL_ID);
}

// reads current values from the running server — one query per rule,
// written directly to the console (like the stat queries) so the console
// view is not flooded with command entries. The UI supplies the names it
// displays (version-filtered); every name is re-validated here.
export function queryGamerules(
    ctx: ServiceContext<GameServerState>,
    names: string[],
): boolean {
    if (ctx.state.serverStatus !== "online") return false;
    const profile = profileFor(ctx);
    const known = names.filter(isKnownGameruleName).slice(0, MAX_GAMERULE_WRITES);
    for (const name of known) {
        processApi.write(
            SERVER_PROC_ID,
            `gamerule ${serverGameruleName(profile, name)}\n`,
        );
    }
    return true;
}

// offline edits re-apply the moment the server reports online, then leave
// the config — an in-game change after boot must never be clobbered by a
// stale saved value on the next boot
export async function applyPendingGamerules(
    ctx: ServiceContext<GameServerState>,
): Promise<void> {
    let saved: Record<string, unknown> | undefined;
    try {
        saved = await config.get<Record<string, unknown>>(PANEL_ID);
    } catch (err) {
        console.error("[Service:Gamerules] config read failed; offline edits not applied:", err);
        return;
    }
    const pending = saved?.pendingGamerules;
    if (!pending || typeof pending !== "object") return;

    const entries = Object.entries(pending as Record<string, string>);
    if (entries.length === 0) return;
    if (entries.length > MAX_GAMERULE_WRITES) {
        console.error(
            `[Service:Gamerules] refusing ${entries.length} pending edits (cap ${MAX_GAMERULE_WRITES})`,
        );
        return;
    }

    const profile = profileFor(ctx);
    for (const [name, value] of entries) {
        try {
            // re-validate at this boundary: the config file is edited by
            // users too, and these strings reach console commands
            const safeName = assertGameruleName(name);
            const safeValue = assertGameruleValue(safeName, value);
            processApi.write(
                SERVER_PROC_ID,
                `gamerule ${serverGameruleName(profile, safeName)} ${serverGameruleValue(profile, safeName, safeValue)}\n`,
            );
        } catch (err) {
            console.error(`[Service:Gamerules] pending edit refused:`, err);
        }
    }

    try {
        await config.set({ ...(saved ?? {}), pendingGamerules: {} }, PANEL_ID);
    } catch (err) {
        console.error("[Service:Gamerules] clearing applied edits failed:", err);
    }
}

// called once when the server first reports online
export async function onServerOnline(ctx: ServiceContext<GameServerState>): Promise<void> {
    await applyPendingGamerules(ctx);
}
