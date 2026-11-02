import { installApp, installedBuild, latestBuild } from "./steamcmd";
import { assertHost, exclusive, gameAction, hostSupportHere, readSettings, updateSettings, type BusyFlag, type Context } from "../serviceKit";
import type { GameDefinition } from "../types";

export interface SteamInstallSpec {
    game: GameDefinition;
    appId: number;
    /** Action ids: the install's facts, its newest build on Steam, and install or update. */
    ids: { info: string; latest: string; install: string };
    installDir(): Promise<string>;
    flag(): BusyFlag;
    /** The game's own setup after each download, such as links and generated settings. */
    afterInstall(): Promise<void>;
    loadOptions(ctx: Context): Promise<void>;
    /**
     * Whether setup asks something after the download (a Source game's
     * mode and map). The server is set up once that is answered, not when
     * the download ends, so setup left at that step opens there again.
     */
    setupAfterInstall?: boolean;
}

/** Downloads one Steam app with the install's progress in state; any failure shows as an error stage, then throws. */
export async function installWithProgress(ctx: Context, appId: number, dir: string, after: () => Promise<void>): Promise<string> {
    // SteamCMD updates itself and signs in before it says anything about the app
    ctx.setState({ installProgress: { stage: "preparing", percent: 0 } });
    let last = "";
    try {
        const build = await installApp(appId, dir, {
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
    /** Steam's newest public build */
    latest: string;
    /** true only for an install that is behind; a server not installed has nothing to update */
    updateAvailable: boolean;
}

/** Asks Steam for the newest build and compares it with the install. Throws when Steam cannot be asked. */
export async function steamUpdateStatus(spec: Pick<SteamInstallSpec, "appId" | "installDir">, steam: Parameters<typeof latestBuild>[1] = {}): Promise<SteamUpdateStatus> {
    const installed = await installedBuild(spec.appId, await spec.installDir());
    const latest = await latestBuild(spec.appId, steam);
    return { installed, latest, updateAvailable: installed !== null && installed !== latest };
}

/** Installs the newest build, or the first one; the Updates tab's install and an automatic update both run it. */
export function steamInstall(spec: SteamInstallSpec): (ctx: Context) => Promise<void> {
    const name = spec.game.name;
    return (ctx) => exclusive(ctx, spec.flag(), name, async () => {
        assertHost(spec.game);
        const build = await installWithProgress(ctx, spec.appId, await spec.installDir(), spec.afterInstall);
        await updateSettings(spec.setupAfterInstall ? { build } : { configured: true, build });
        await spec.loadOptions(ctx);
    });
}

/** The Updates tab's three Actions for a game downloaded from Steam. */
export function steamInstallActions(spec: SteamInstallSpec) {
    const name = spec.game.name;
    const install = steamInstall(spec);
    return [
        gameAction(spec.ids.info, `${name} install`, async () => {
            const saved = await readSettings();
            return { host: hostSupportHere(spec.game), build: await installedBuild(spec.appId, await spec.installDir()), version: typeof saved.version === "string" ? saved.version : null };
        }),
        gameAction(spec.ids.latest, `${name} newest build`, () => steamUpdateStatus(spec)),
        gameAction(spec.ids.install, `Install or update ${name}`, async (ctx) => { await install(ctx); return true; }),
    ];
}
