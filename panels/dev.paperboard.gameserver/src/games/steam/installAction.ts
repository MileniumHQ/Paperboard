import type { Server } from "../../service/server";
import { appSize, installApp, installedBuild, latestBuild } from "./steamcmd";
import { assertHost, exclusive, hostSupportHere, type BusyFlag } from "../serviceKit";
import type { ServerCalls } from "../../service/calls";
import type { GameDefinition } from "../types";

export interface SteamInstallSpec {
    game: GameDefinition;
    appId: number;
    /** The Steam branch the server is installed from, when it is not the public one. */
    branch?: string;
    installDir(): Promise<string>;
    flag(): BusyFlag;
    /** The game's own setup after each download, such as links and generated settings. */
    afterInstall(): Promise<void>;
    loadOptions(): Promise<void>;
    /**
     * Whether setup asks something after the download (a Source game's
     * mode and map). The server is set up once that is answered, not when
     * the download ends, so setup left at that step opens there again.
     */
    setupAfterInstall?: boolean;
}

/** Downloads one Steam app with the install's progress in state; any failure shows as an error stage, then throws. */
export async function installWithProgress(ctx: Server, appId: number, dir: string, after: () => Promise<void>, branch?: string): Promise<string> {
    // SteamCMD updates itself and signs in before it says anything about the app
    ctx.setState({ installProgress: { stage: "preparing", percent: 0 } });
    let last = "";
    try {
        const build = await installApp(appId, dir, {
            branch,
            onProgress: ({ stage, percent, bytes }) => {
                const next = { stage, percent: Math.floor(percent), bytes };
                // a big game moves a percent in minutes; its bytes, a tenth of a megabyte at a time, show it moving
                const key = `${stage}${next.percent}:${Math.floor(bytes.done / 100_000)}`;
                if (key === last) return;
                last = key;
                ctx.setState({ installProgress: next });
            },
        });
        ctx.setState({ installProgress: { stage: "installing", percent: 100 } });
        await after();
        ctx.setState({ installProgress: { stage: "completed", percent: 100 } });
        return build;
    } catch (err) {
        ctx.setState({ installProgress: { stage: "error", percent: 0 } });
        throw err;
    }
}

/** Whether Steam has a newer public build of a game than the one installed. */
export interface SteamUpdateStatus {
    /** the installed build; null before an install */
    installed: string | null;
    /** Steam's newest build on the branch the server is installed from */
    latest: string;
    /** true only for an install that is behind; a server not installed has nothing to update */
    updateAvailable: boolean;
}

/** Asks Steam for the newest build and compares it with the install. Throws when Steam cannot be asked. */
export async function steamUpdateStatus(spec: Pick<SteamInstallSpec, "appId" | "branch" | "installDir">, steam: Parameters<typeof latestBuild>[1] = {}): Promise<SteamUpdateStatus> {
    const installed = await installedBuild(spec.appId, await spec.installDir());
    const latest = await latestBuild(spec.appId, { branch: spec.branch, ...steam });
    return { installed, latest, updateAvailable: installed !== null && installed !== latest };
}

/**
 * Installs the newest build, or the first one; the Updates tab's install and
 * an automatic update both run it. An install already running is followed
 * instead of refused, so setup opened again shows it.
 */
export function steamInstall(ctx: Server, spec: SteamInstallSpec): () => Promise<void> {
    const name = spec.game.name;
    let running: Promise<void> | null = null;
    return () => running ??= exclusive(ctx, spec.flag(), name, async () => {
        assertHost(spec.game);
        const build = await installWithProgress(ctx, spec.appId, await spec.installDir(), spec.afterInstall, spec.branch);
        await ctx.updateSettings(spec.setupAfterInstall ? { build } : { configured: true, build });
        await spec.loadOptions();
    }).finally(() => { running = null; });
}

/** The calls for a game downloaded from Steam: setup's and the Updates tab's. */
export function steamInstallCalls(spec: SteamInstallSpec, install: () => Promise<void>): ServerCalls {
    return {
        steamInfo: async (ctx) => {
            const saved = ctx.settings;
            return {
                host: hostSupportHere(spec.game),
                build: await installedBuild(spec.appId, await spec.installDir()),
                version: typeof saved.version === "string" ? saved.version : null,
                // a finished install saves its build; one cut short does not
                downloaded: typeof saved.build === "string",
            };
        },
        steamSize: () => appSize(spec.appId, { branch: spec.branch }),
        steamLatest: () => steamUpdateStatus(spec),
        steamInstall: async () => { await install(); return true; },
    };
}
