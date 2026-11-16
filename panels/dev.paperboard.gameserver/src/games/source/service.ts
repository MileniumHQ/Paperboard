// A Source game's part of one server, put together from its jobs: the
// instance (instance.ts) holds what they share, and config files, maps,
// SourceMod, players, libraries and launch are each a module handed it.
import type { Server } from "../../service/server";
import path from "node:path";
import { initialServerState } from "../../service/initialState";
import { validateOptions } from "../options";
import { steamInstall, steamInstallCalls, steamUpdateStatus, type SteamInstallSpec } from "../steam/installAction";
import { isLinked, offlineBackup, redact, report, settingPort, singleLine } from "../serviceKit";
import type { GameDefinition } from "../types";
import type { GameService } from "../serviceTypes";
import { rotatesMaps, type SourceGameSpec } from "./index";
import { cvarValue, mapName } from "./config";
import { consoleLine, isShaderNoise, linePlayer, parseLogLine } from "./log";
import { passwordReadAsTls, SourceRcon, RconError, RconNoAnswer } from "./rcon";
import { SourceRoster } from "./roster";
import { SourceGame } from "./instance";
import { linkLogs, release, removeSecrets, rewriteConfigs, writeConfigs } from "./files";
import { mapAvailable, mapCalls } from "./rotation";
import { modCalls, modsOn } from "./modLinks";
import { playerBlocks, playerCalls } from "./people";
import { DEFAULT_CLIENT_PORT, prepareLaunch } from "./launch";

/** the colours some servers (Garry's Mod's) write into their console lines */
const ANSI = /\x1b\[[0-9;]*m/g;

export function sourceService(spec: SourceGameSpec, definition: GameDefinition): (ctx: Server) => GameService {
    const options = spec.options;

    // each server's part of the game is its own: its process, console, settings files and players
    return (ctx: Server): GameService => {
        const game = new SourceGame(spec, definition, ctx);
        const steam: SteamInstallSpec = {
            game: definition, appId: spec.appId, branch: spec.branch,
            installDir: () => game.installDir(), flag: () => game, loadOptions: () => game.loadOptions(),
            async afterInstall() { await linkLogs(game); await writeConfigs(game); },
            // a game with a map rotation ends setup with how the server plays (ids.play)
            setupAfterInstall: rotatesMaps(spec),
        };
        const install = steamInstall(ctx, steam);
        const releaseFiles = () => release(game);

        return {
            primaryProcessId: game.processId, processIds: [game.processId],
            backupExclude: ["install"],
            updateStatus: () => steamUpdateStatus(steam),
            installUpdate: install,
            initialState: () => ({ ...initialServerState(), serverSoftware: spec.id, serverPort: String(spec.defaultPort), serverMotd: "" }),
            blocks: () => playerBlocks(game),
            calls: async () => { const { sharedCalls } = await import("../../service/calls"); return { ...sharedCalls,
                readGameOptions: async (ctx) => { await game.loadOptions(); return ctx.state.gameSettings; },
                writeGameOptions: async (ctx, { patch }) => {
                    game.refuseWhileBusy();
                    if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new Error("Options patch is required");
                    const next = validateOptions(options, spec.name, patch, ctx.settings);
                    // the starting map is chosen from the installed ones; the Overview offers only those
                    if (Object.hasOwn(patch, "map") && !(await mapAvailable(game, mapName(patch.map)))) throw new Error(`${patch.map} is not installed`);
                    if (spec.rconReadsTls && typeof patch.rconPassword === "string" && passwordReadAsTls(patch.rconPassword))
                        throw new Error(`${spec.name}'s server takes an RCON password of exactly ${Buffer.byteLength(patch.rconPassword, "utf8")} characters for a web request and drops it. Make it longer or shorter.`);
                    // refuse what a console line can't hold before anything is saved
                    for (const option of options) if (Object.hasOwn(patch, option.id) && (option.cvar || option.kind === "secret") && patch[option.id] !== "") cvarValue(patch[option.id], option.label);
                    const live: string[] = [];
                    for (const option of options) {
                        if (!Object.hasOwn(patch, option.id) || option.restartRequired) continue;
                        if (option.cvar) live.push(`${option.cvar} ${cvarValue(patch[option.id], option.label)}`);
                        if (option.id === "password") live.push(`sv_password ${cvarValue(patch.password, option.label)}`);
                    }
                    for (const [id, secret] of game.vaulted) if (Object.hasOwn(patch, id)) await secret.set(String(patch[id]));
                    await ctx.updateSettings(next);
                    if (ctx.state.serverStatus === "online") {
                        if (Object.hasOwn(patch, "password")) game.secrets = [...game.secrets, String(patch.password)].filter(Boolean);
                        for (const line of live) await game.rcon().exec(line);
                    }
                    await rewriteConfigs(game);
                    await game.loadOptions();
                    return ctx.state.gameSettings;
                },
                ...steamInstallCalls(steam, install),
                ...playerCalls(game),
                ...modCalls(game),
                ...mapCalls(game),
            }; },
            loadOptions: () => game.loadOptions(),
            async initialize(running) {
                game.loadedRoster = new SourceRoster(await ctx.root());
                if (running) {
                    // reattaching to a running server: talk to it with the password it started with
                    const saved = ctx.settings;
                    const password = await game.rconPassword.value();
                    if (!password) throw new Error(`${spec.name} is running without the RCON password Paperboard set; stop it from the computer and start it again here`);
                    game.connection = new SourceRcon(ctx.runPort("game", Number(saved.port ?? spec.defaultPort)), password, spec.name);
                    game.secrets = [password, await game.joinPassword.value(), await game.loginToken.value()].filter(Boolean);
                    // the links are what the server started with: placeMods makes them only at a start
                    game.modsActive = (await modsOn(game)) && (await isLinked(path.join(await game.gameDir(), "addons")));
                    await game.players.readStatus().catch((err) => report(ctx, `Could not read who is on ${spec.name}`, err));
                } else await releaseFiles().catch((err) => report(ctx, `Could not put ${spec.name}'s files back after its last run`, err));
            },
            async beforeRemove() { if (game.busy) throw new Error(`Wait for ${spec.name}'s current operation`); },
            async dispose() {
                game.players.dispose();
                game.connection?.close();
                game.connection = null;
                game.modsActive = false;
                game.console.dispose();
            },
            prepareLaunch: () => prepareLaunch(game),
            afterStop: releaseFiles,
            isMutating: () => game.busy,
            readiness: { timeoutMs: 300_000, async probe() {
                try { await game.players.readStatus(); }
                catch (err) {
                    // RCON listens once the map has loaded, and a reply lost to a
                    // scanner's banned RCON attempt is asked for again
                    if (err instanceof RconNoAnswer) return false;
                    throw err;
                }
                await removeSecrets(game);
                return true;
            } },
            async saveWorld() { throw new Error(`${spec.name} keeps no world to save`); },
            stopTimeoutMs: 30_000, stopEntry: "quit",
            async stop() {
                // the server logs no one leaving as it quits
                await game.players.saveStats().catch((err) => report(ctx, "Could not save players' stats", err));
                try { await game.rcon().exec("quit"); }
                catch (err) {
                    // the server closes the connection as it quits
                    if (!(err instanceof RconError && /closed the RCON connection/.test(err.message))) throw err;
                }
            },
            commandLine(command) {
                if (/[\r\n\0]/.test(command)) throw new Error("A command must be a single line");
                if (/^\s*(rcon_password|quit|exit)\b/i.test(command)) throw new Error("Paperboard manages the RCON password; use Options for it and Stop to quit");
                return command.trim();
            },
            async sendCommand(command) {
                // the server prints the reply to its console, which the console view shows
                await game.rcon().exec(command);
            },
            async sendChat(message) {
                await game.rcon().exec(`say ${singleLine(message, "Message")}`);
            },
            observeLine(raw) {
                const line = redact(raw.replace(/\r/g, "").replace(ANSI, ""), game.secrets);
                // every line about a player names their team, kills and objectives too; status doesn't
                const subject = linePlayer(line);
                const known = subject?.team && subject.team !== "Unassigned" ? game.players.online.get(subject.userId) : undefined;
                if (known) known.team = subject!.team;
                const event = parseLogLine(line);
                if (event) game.players.observe(event);
                if (!line.trim() || isShaderNoise(line)) return;
                game.console.push(ctx, consoleLine(line));
            },
            async assertFileAccess(file, write) {
                if (typeof file !== "string") throw new Error("Choose a file");
                if (file.endsWith("paperboard_secrets.cfg")) throw new Error(`That file holds ${spec.name}'s passwords while it starts`);
                if (write && (file === "install" || file.startsWith("install/"))) throw new Error(`Installed ${spec.name} files are managed by Updates. Put your own settings in server.cfg in the server folder.`);
                if (write) game.refuseWhileBusy();
            },
            // short: the registry prefixes them with the server id and caps them at 32 characters
            portNames: ["game", "client"],
            async *ports() {
                const saved = ctx.settings;
                yield settingPort({ name: "game", label: spec.name, protocol: "tcp+udp", key: "port", fallback: spec.defaultPort }, saved);
                yield settingPort({ name: "client", label: `${spec.name} client`, protocol: "udp", key: "clientPort", fallback: DEFAULT_CLIENT_PORT }, saved);
            },
            backup: spec.offlineBackups
                ? offlineBackup(ctx, {
                    name: spec.name, processId: game.processId, flag: () => game,
                    announce: async () => { await game.rcon().exec("say The server is stopping for a backup and will be back shortly."); },
                    // the server writes what it keeps as it goes, and closes it as it quits
                    save: async () => {},
                    clean: releaseFiles,
                })
                : { mode: "quiesce", before: async () => {}, recover: async () => {}, withConsistentData: (work) => work() },
        };
    };
}
