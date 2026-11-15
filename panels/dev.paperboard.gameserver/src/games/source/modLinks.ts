// SourceMod on one server: its folders live in the server folder and are
// linked into the game's while it is on (games/source/sourcemod.ts keeps them).
import fs from "node:fs/promises";
import path from "node:path";
import { packages as packageApi } from "../../service/api";
import type { ServerCalls } from "../../service/calls";
import { addonStageDir } from "../../core/addonUpload";
import { linkFolder, unlinkFolder } from "../serviceKit";
import { SOURCE_CALLS as ids, SOURCEMOD_PACKAGES, type SourceModView } from "./index";
import { pluginFile, SourceMod, SOURCEMOD_MISSING } from "./sourcemod";
import type { SourceGame } from "./instance";

export const mods = async (game: SourceGame) => new SourceMod(await game.server.root());
export const modsOn = async (game: SourceGame) => !!game.spec.sourcemod && game.server.settings.sourcemod === true;

function supportsMods(game: SourceGame) {
    if (!game.spec.sourcemod) throw new Error(`SourceMod does not run on ${game.spec.name}`);
}
async function modsView(game: SourceGame): Promise<SourceModView> {
    supportsMods(game);
    const on = await modsOn(game);
    return { on, active: game.modsActive && game.server.state.serverStatus === "online", ...(await (await mods(game)).view(on)) };
}
async function modChange(game: SourceGame, work: (sm: SourceMod) => Promise<void>): Promise<SourceModView> {
    supportsMods(game);
    if (game.modsBusy) throw new Error("Wait for the current SourceMod change to finish");
    game.modsBusy = true;
    try { await work(await mods(game)); } finally { game.modsBusy = false; }
    return modsView(game);
}
/** A console command for SourceMod on the running server, when it loaded there. */
async function smLive(game: SourceGame, command: string): Promise<string | null> {
    if (!game.modsActive || game.server.state.serverStatus !== "online") return null;
    return game.rcon().exec(command);
}
async function loadPlugin(game: SourceGame, file: string) {
    const reply = await smLive(game, `sm plugins load ${file}`);
    if (reply !== null && !/Loaded plugin|already loaded/i.test(reply)) throw new Error(`SourceMod did not load ${file}: ${reply.replace(/^\[SM\]\s*/, "").trim()}`);
}
/** Links SourceMod's folders into the game's while it is on, and takes them out while it is off; gives whether it is on. */
export async function placeMods(game: SourceGame): Promise<boolean> {
    // a game without SourceMod has no links of its to make or take out; its own addons folder stays as it is
    if (!game.spec.sourcemod) return false;
    const links = [path.join(await game.gameDir(), "addons"), path.join(await game.cfgDir(), "sourcemod")] as const;
    if (!(await modsOn(game))) {
        for (const link of links) await unlinkFolder(link);
        return false;
    }
    const sm = await mods(game);
    if (!(await sm.installed())) throw new Error(SOURCEMOD_MISSING);
    await linkFolder(links[0], sm.addons);
    await linkFolder(links[1], sm.cfg);
    return true;
}

/** The calls of the Mods tab. */
export function modCalls(game: SourceGame): ServerCalls {
    return {
        [ids.sourcemod]: () => modsView(game),
        [ids.sourcemodSet]: (ctx, { on }) => modChange(game, async (sm) => {
            if (typeof on !== "boolean") throw new Error("Choose on or off");
            if (on && !(await sm.installed())) {
                const [metamod, sourcemod] = await Promise.all(SOURCEMOD_PACKAGES.map(async ({ id }) => {
                    if (!(await packageApi.isInstalled(id))) await packageApi.download(id);
                    return path.join(await packageApi.getPath(id), "bin");
                }));
                await sm.install(metamod!, sourcemod!);
            }
            await ctx.updateSettings({ sourcemod: on });
            // a running server keeps what it started with until it restarts
            if (ctx.state.serverStatus === "offline") await placeMods(game);
        }),
        [ids.plugin]: (_ctx, { file, on }) => modChange(game, async (sm) => {
            if (typeof on !== "boolean") throw new Error("Choose on or off");
            const name = pluginFile(file);
            if (!(await sm.setEnabled(name, on))) return;
            if (on) await loadPlugin(game, name);
            else await smLive(game, `sm plugins unload ${name}`);
        }),
        [ids.pluginRemove]: (_ctx, { file }) => modChange(game, async (sm) => {
            const name = pluginFile(file);
            await smLive(game, `sm plugins unload ${name}`);
            await sm.remove(name);
        }),
        [ids.pluginUpload]: async (ctx, { stage }) => {
            const dir = path.join(await ctx.root(), addonStageDir(stage));
            let added: string[] = [];
            try {
                const view = await modChange(game, async (sm) => {
                    if (!(await modsOn(game))) throw new Error("Turn SourceMod on before adding plugins");
                    added = await sm.upload(dir);
                    const enabled = new Set((await sm.list()).filter((p) => p.enabled).map((p) => p.file));
                    // a plugin of the same name that was running is replaced by the new one
                    for (const name of added) {
                        await smLive(game, `sm plugins unload ${name}`);
                        if (enabled.has(name)) await loadPlugin(game, name);
                    }
                });
                return { added, view };
            } finally { await fs.rm(dir, { recursive: true, force: true }); }
        },
        discardAddonUpload: async (ctx, { stage }) => { await fs.rm(path.join(await ctx.root(), addonStageDir(stage)), { recursive: true, force: true }); return true; },
        [ids.admin]: (_ctx, { steamId: raw, admin }) => modChange(game, async (sm) => {
            if (typeof admin !== "boolean") throw new Error("Choose admin or not");
            if (!(await modsOn(game))) throw new Error("Turn SourceMod on in Mods first");
            const id = game.steamId(raw);
            if (!game.isPlayer(id)) throw new Error("Only a Steam player can be an admin");
            await sm.setAdmin(id, admin);
            await smLive(game, "sm_reloadadmins");
        }),
    };
}
