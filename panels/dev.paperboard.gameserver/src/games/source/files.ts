// The files Paperboard writes into a Source server's install: server.cfg and
// the ban list from its settings, the start's passwords, and the links that
// keep the game's logs and the owner's own files in the server folder.
import fs from "node:fs/promises";
import path from "node:path";
import { exists, keptFile, linkFolder } from "../serviceKit";
import { serverCfg } from "./config";
import { cfgMapCycleFile, mapCycleFile, PAPERBOARD_MAPCYCLE } from "./mapcycle";
import { bannedUserCfg } from "./roster";
import type { SourceGame } from "./instance";

const userCfg = async (game: SourceGame) => path.join(await game.server.root(), "server.cfg");

/** Writes server.cfg and banned_user.cfg into the install from the panel's settings and ban list. */
export async function writeConfigs(game: SourceGame): Promise<void> {
    const dir = await game.cfgDir();
    await fs.mkdir(dir, { recursive: true });
    const user = await userCfg(game);
    const hasUser = await exists(user);
    if (hasUser) await fs.copyFile(user, path.join(dir, "paperboard_user.cfg"));
    else await fs.rm(path.join(dir, "paperboard_user.cfg"), { force: true });
    const saved = game.server.settings;
    await fs.writeFile(path.join(dir, "server.cfg"), serverCfg(game.spec.options, saved, hasUser));
    await fs.writeFile(path.join(dir, "banned_user.cfg"), bannedUserCfg(await game.roster().bans()));
    if (Array.isArray(saved.mapCycle)) await fs.writeFile(path.join(dir, PAPERBOARD_MAPCYCLE), mapCycleFile(saved.mapCycle as string[]));
    else await fs.rm(path.join(dir, PAPERBOARD_MAPCYCLE), { force: true });
}
/** Writes the configs again after a change, once the game is installed; before then the install writes them. */
export async function rewriteConfigs(game: SourceGame): Promise<void> {
    if (await exists(await game.installDir())) await writeConfigs(game);
}
/** What a server.cfg in the server folder sets mapcyclefile to; it has the last word over the rotation set here. */
export async function userMapCycleFile(game: SourceGame): Promise<string | null> {
    const user = await userCfg(game);
    return (await exists(user)) ? cfgMapCycleFile(await fs.readFile(user, "utf8")) : null;
}

export const secretsFile = async (game: SourceGame) => path.join(await game.cfgDir(), "paperboard_secrets.cfg");
export async function removeSecrets(game: SourceGame): Promise<void> {
    await fs.rm(await secretsFile(game), { force: true });
}

/**
 * Points the game's logs folder at logs/ in the server folder, where Logs
 * reads them and backups keep them, and with it the folders the game
 * keeps of the owner's (spec.keeps).
 */
export async function linkLogs(game: SourceGame): Promise<void> {
    const dir = await game.gameDir();
    const home = await game.server.root();
    for (const folder of ["logs", ...(game.spec.keeps?.folders ?? [])]) await linkFolder(path.join(dir, folder), path.join(home, folder));
}
/** The files the game keeps of the owner's (spec.keeps), each between the game's folder and the server folder. */
export async function keptFiles(game: SourceGame) {
    const dir = await game.gameDir();
    const home = await game.server.root();
    return (game.spec.keeps?.files ?? []).map((file) => keptFile(path.join(dir, file), path.join(home, file)));
}
/** Once the server is gone its kept files are the server folder's again, and the start's passwords are off the disk. */
export async function release(game: SourceGame): Promise<void> {
    await removeSecrets(game);
    for (const file of await keptFiles(game)) await file.takeBack();
}
