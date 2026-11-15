// Readies a Source server's start: checks the install and its starting map,
// writes its configs and the start's passwords, links its logs and SourceMod,
// and gives the command line with the ports this run claimed.
import fs from "node:fs/promises";
import path from "node:path";
import { installedBuild, steamClientLibrary } from "../steam/steamcmd";
import { assertHost, exists, writePrivate } from "../serviceKit";
import type { PreparedLaunch } from "../serviceTypes";
import { mapName, optionValue, secretsCfg } from "./config";
import { SourceRcon } from "./rcon";
import { keptFiles, linkLogs, secretsFile, writeConfigs } from "./files";
import { mapAvailable } from "./rotation";
import { placeMods } from "./modLinks";
import { libraryPath } from "./libraries";
import type { SourceGame } from "./instance";

export const DEFAULT_CLIENT_PORT = 27005;
const STDBUF = ["/usr/bin/stdbuf", "/bin/stdbuf"];

export async function prepareLaunch(game: SourceGame): Promise<PreparedLaunch> {
    const { spec, server } = game;
    const options = spec.options;
    assertHost(game.definition);
    const saved = server.settings;
    const install = await game.installDir();
    if (!(await installedBuild(spec.appId, install))) throw new Error(`Install ${spec.name} in Updates first`);
    const windows = process.platform === "win32";
    const binary = spec.binaries[windows ? "win32" : "linux"]!;
    const executable = path.join(install, binary.executable);
    await fs.access(executable, windows ? fs.constants.F_OK : fs.constants.X_OK);
    const map = mapName(optionValue(options.find((o) => o.id === "map")!, saved));
    if (!(await mapAvailable(game, map))) throw new Error(`The starting map ${map} is not installed; choose another on the Overview`);

    // Linux: Source holds its console output in a buffer when it isn't a terminal,
    // links libraries the computer may lack, and loads Steam's client library from ~/.steam/sdk64
    let linux: { stdbuf: string; env: Record<string, string> } | null = null;
    if (!windows) {
        const stdbuf = (await Promise.all(STDBUF.map(async (p) => ((await exists(p)) ? p : null)))).find(Boolean);
        if (!stdbuf) throw new Error(`${spec.name}'s console needs stdbuf from coreutils, which this computer doesn't have`);
        const libraries = await libraryPath(server, spec, install);
        const home = path.join(await server.root(), "profile");
        const sdk = path.join(home, ".steam", "sdk64");
        await fs.mkdir(sdk, { recursive: true });
        await fs.copyFile(await steamClientLibrary(), path.join(sdk, "steamclient.so"));
        linux = { stdbuf, env: { HOME: home, XDG_DATA_HOME: home, LD_LIBRARY_PATH: libraries.join(":") } };
    }

    const rconSecret = await game.rconPassword.ensure();
    const join = await game.joinPassword.value();
    const token = await game.loginToken.value();
    await linkLogs(game);
    for (const file of await keptFiles(game)) await file.place();
    const modsActive = await placeMods(game);
    await writeConfigs(game);
    await writePrivate(await secretsFile(game), secretsCfg({ rcon: rconSecret, join, token }));

    const port = server.runPort("game", Number(saved.port ?? spec.defaultPort));
    game.connection?.close();
    game.connection = new SourceRcon(port, rconSecret, spec.name);
    game.secrets = [rconSecret, join, token].filter(Boolean);
    game.players.online.clear();
    game.modsActive = modsActive;
    const internet = optionValue(options.find((o) => o.id === "internet")!, saved) !== false;
    const own = (await spec.launchArgs?.(saved, await game.gameDir())) ?? [];
    const args = ["-game", spec.gameDir, "-console", "-ip", "0.0.0.0", "-port", String(port), "+clientport", String(server.runPort("client", Number(saved.clientPort ?? DEFAULT_CLIENT_PORT))), "-nohltv", "+maxplayers", String(Number(optionValue(options.find((o) => o.id === "maxplayers")!, saved))), "+sv_lan", internet ? "0" : "1", "+exec", "paperboard_secrets.cfg", ...own, "+map", map];
    return {
        message: `Starting ${spec.name}${saved.build ? ` build ${saved.build}` : ""}…`,
        command: linux
            ? { executable: linux.stdbuf, args: ["-oL", "-eL", executable, ...args], cwd: install, env: linux.env }
            // Windows: -console reads a real console and quits on a pipe; Paperboard talks over RCON
            : { executable, args, cwd: install, env: {}, consoleInput: true },
    };
}
