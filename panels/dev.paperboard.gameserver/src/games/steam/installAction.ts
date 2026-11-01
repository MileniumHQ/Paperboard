import { installApp, installedBuild } from "./steamcmd";
import { assertHost, exclusive, gameAction, hostSupportHere, readSettings, updateSettings, type BusyFlag, type Context } from "../serviceKit";
import type { GameDefinition } from "../types";

export interface SteamInstallSpec {
    game: GameDefinition;
    appId: number;
    /** Action ids: the install's facts, and install or update. */
    ids: { info: string; install: string };
    installDir(): Promise<string>;
    flag(): BusyFlag;
    /** The game's own setup after each download, such as links and generated settings. */
    afterInstall(): Promise<void>;
    loadOptions(ctx: Context): Promise<void>;
}

/** Downloads one Steam app with the install's progress in state; any failure shows as an error stage, then throws. */
export async function installWithProgress(ctx: Context, appId: number, dir: string, after: () => Promise<void>): Promise<string> {
    ctx.setState({ installProgress: { stage: "downloading", percent: 0 } });
    let last = "";
    try {
        const build = await installApp(appId, dir, {
            onProgress: ({ stage, percent }) => {
                const next = { stage: stage === "verifying" ? "verifying" as const : "downloading" as const, percent: Math.floor(percent) };
                if (`${next.stage}${next.percent}` === last) return;
                last = `${next.stage}${next.percent}`;
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

/** The Updates tab's two Actions for a game downloaded from Steam. */
export function steamInstallActions(spec: SteamInstallSpec) {
    const name = spec.game.name;
    return [
        gameAction(spec.ids.info, `${name} install`, async () => {
            const saved = await readSettings();
            return { host: hostSupportHere(spec.game), build: await installedBuild(spec.appId, await spec.installDir()), version: typeof saved.version === "string" ? saved.version : null };
        }),
        gameAction(spec.ids.install, `Install or update ${name}`, (ctx) => exclusive(ctx, spec.flag(), name, async () => {
            assertHost(spec.game);
            const build = await installWithProgress(ctx, spec.appId, await spec.installDir(), spec.afterInstall);
            await updateSettings({ configured: true, build });
            await spec.loadOptions(ctx);
            return true;
        })),
    ];
}
