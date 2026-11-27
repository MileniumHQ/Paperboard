import type { Server } from "../../service/server";
import fs from "node:fs/promises";
import path from "node:path";
import { initialServerState } from "../../service/initialState";
import { TRIGGER_IDS } from "../../service/contract";
import { stopLeftoverInstaller } from "../../service/installerProcess";
import { validateOptions } from "../options";
import type { GameService } from "../serviceTypes";
import {
    ConsoleBuffer, assertHost, exclusive, exists, hostSupportHere, offlineBackup, playerPoller, pushChat, redact, report,
    serverSecret, settingPort, settled, singleLine, unlessMissing, waitUntil, writePrivate,
} from "../serviceKit";
import { recoverRelease } from "../releaseSwap";
import { SourceRcon, RconNoAnswer } from "../source/rcon";
import { FACTORIO_DEFAULT_PORT, factorio, MAP_GENERATION, options } from "./index";
import { newestRelease } from "./catalog";
import { dataIn, executableIn, installedRelease, installRelease, toolProcessId, toolRunner, type ToolRunner } from "./install";
import { FactorioLists, LIST_FILES, parseOnline, playerName, type FactorioList } from "./lists";
import { modListFor, optionValue, playerDataWithoutSecrets, publicProblem, saveName, seedValue, serverSettings, setting, spaceAgeOn } from "./settings";
import { discardUpload, importUpload, inspectUpload, listWorlds, saveFile, savesDir, trashWorld } from "./saves";

const GAME = "factorio";
const PROC = "factorio-server";
const DEFAULT_RCON_PORT = 27015;
/** the server's write-data folder: saves, mods, lists, its own log */
const DATA = "data";
/** server-settings.json for the run, which holds the join password and token while the server runs */
const RUN_SETTINGS = ".server-settings.json";
/** the server's own record of the last game it hosted, into which it copies the token and the join password */
const PLAYER_DATA = "player-data.json";
const FIRST_WORLD = "World";
const BAN_REASON = "Banned by the server admin";

/** Factorio's own errors; its lines begin with the seconds since it started, then the level */
const isError = (line: string) => /^\s*\d+\.\d+ Error\b/.test(line);
/** The server is hosting the map: "changing state from(CreatingGame) to(InGame)". */
const IN_GAME = /changing state from\(CreatingGame\) to\(InGame\)/;
/** A save written to disk: /server-save's "Saving finished", or the stop's "Saving progress: 100.000000%". */
const SAVED = /\bSaving finished$|\bSaving progress: 100(?:\.0+)?%$/;
/** "   0.000 2026-11-27 03:14:08; Factorio 2.1.25 (build 88022, linux64, headless, space-age)" */
const VERSION = /^\s*[\d.]+ \d{4}-\d\d-\d\d [\d:]+; Factorio (\d+\.\d+\.\d+) \(build/;
/** "2026-11-27 03:08:39 [CHAT] <server>: hello", or a player's name before the colon */
const CHAT = /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d \[CHAT\] (.+?): (.*)$/;

/** Nauvis's evolution factor in /evolution's answer, as a fraction. */
export function parseEvolution(reply: string): number | null {
    const line = reply.split(/\r?\n/).find((l) => l.includes("[planet=nauvis]")) ?? reply.split(/\r?\n/)[0] ?? "";
    const m = /Evolution factor: (\d+(?:\.\d+)?)/.exec(line);
    return m ? Number(m[1]) : null;
}

/** One server's part of the game: its process, console, saves and lists are its own. */
export function factorioService(ctx: Server, run: ToolRunner = toolRunner(ctx)): GameService {
    const local = {
        busy: false,
        rcon: null as SourceRcon | null,
        lists: null as FactorioLists | null,
        /** the server is hosting its map */
        inGame: false,
        /** saves the server confirmed this run */
        saves: 0,
        secrets: [] as string[],
        console: new ConsoleBuffer(isError),
    };

    // Layout: install/ is the release and is left out of backups; data/ is the
    // server's write-data folder, with its saves, mods and lists
    const installDir = async () => path.join(await ctx.root(), "install");
    const dataDir = async () => path.join(await ctx.root(), DATA);
    const configFile = async () => path.join(await dataDir(), "config.ini");
    const modList = async () => path.join(await dataDir(), "mods", "mod-list.json");
    const joinPassword = serverSecret(ctx, GAME, "join-password");
    const token = serverSecret(ctx, GAME, "factorio-token");
    const rconPassword = serverSecret(ctx, GAME, "rcon-password");
    const saved = () => ctx.settings;
    const lists = () => { const l = local.lists; if (!l) throw new Error("Factorio's lists are not ready"); return l; };
    const activeName = () => (typeof saved().save === "string" && saved().save ? String(saved().save) : null);

    async function loadOptions() {
        const values: Record<string, unknown> = {};
        for (const option of options) if (option.kind !== "secret") values[option.id] = optionValue(option, saved());
        values.password = await joinPassword.found();
        values.token = await token.found();
        const max = Number(setting("maxPlayers", saved()));
        ctx.setState({ serverSoftware: GAME, serverVersion: String(saved().version ?? ""), serverPort: String(setting("port", saved())), maxPlayers: max > 0 ? max : null, gameSettings: values });
    }

    function rcon(): SourceRcon {
        const client = local.rcon;
        if (!client) throw new Error("Factorio is not running");
        return client;
    }
    function connect(port: number, password: string) {
        local.rcon?.close();
        local.rcon = new SourceRcon(port, password, "Factorio", 15_000, "single");
    }

    const players = playerPoller(ctx, {
        game: "Factorio",
        id: (p: { name: string }) => p.name.toLowerCase(),
        list: async () => parseOnline(await rcon().exec("/players online")).map((name) => ({ name })),
        remember: (list) => lists().remember(list.map((p) => p.name)),
    });

    /** Runs the server binary for a moment of work of its own (a new map, matching mods), with the server stopped. */
    async function tool(args: string[], what: string, done?: RegExp): Promise<void> {
        const install = await installDir();
        const executable = executableIn(install);
        await fs.access(executable, fs.constants.X_OK);
        await writeConfig();
        const result = await run({ id: toolProcessId(ctx), command: executable, args: ["-c", await configFile(), ...args], cwd: await dataDir(), timeoutMs: 5 * 60_000 });
        const said = result.tail.filter((line) => !/Loading mod|Checksum/.test(line));
        if (result.exitCode !== 0 || (done && !result.tail.some((line) => done.test(line)))) {
            const why = said.filter((line) => isError(line)).map((line) => line.replace(/^\s*[\d.]+ Error [^:]+:\d+: /, "")).join(" ") || said.slice(-3).join(" ");
            throw new Error(`Factorio couldn't ${what}: ${why || `it exited with ${result.exitCode}`}`);
        }
    }

    /** Takes the secrets the server copied into player-data.json back out; only while it isn't running. */
    async function scrubPlayerData() {
        const file = path.join(await dataDir(), PLAYER_DATA);
        const text = await unlessMissing(fs.readFile(file, "utf8"), null);
        const scrubbed = text === null ? null : playerDataWithoutSecrets(text);
        if (scrubbed !== null) await fs.writeFile(file, scrubbed);
    }

    /** config.ini: the game's data in the install, and everything it writes in data/. */
    async function writeConfig() {
        const data = await dataDir();
        await fs.mkdir(data, { recursive: true });
        await fs.writeFile(await configFile(), `[path]\nread-data=${dataIn(await installDir())}\nwrite-data=${data}\n`);
    }

    async function requireInstalled() {
        const release = await installedRelease(await installDir());
        if (!release) throw new Error("Install Factorio in Versions first");
        return release;
    }

    /** Makes a map with the game's own generator, now, into the saves folder. */
    async function createWorld(name: string, generation: Record<string, unknown>) {
        await requireInstalled();
        const file = saveFile(await dataDir(), saveName(name));
        if (await exists(file)) throw new Error(`A world named "${name}" already exists`);
        const preset = String(generation.preset ?? "default");
        const seed = seedValue(generation.seed);
        const listFile = await modList();
        await fs.mkdir(path.dirname(listFile), { recursive: true });
        // the map keeps the mods it is made with: the expansion on or off
        await fs.writeFile(listFile, modListFor(await unlessMissing(fs.readFile(listFile, "utf8"), null), generation.spaceAge !== false));
        await tool(["--create", file, "--preset", preset, ...(seed === null ? [] : ["--map-gen-seed", String(seed)])], `make the world ${name}`);
        if (!(await exists(file))) throw new Error(`Factorio finished, but made no world named ${name}`);
    }

    /** The generation options a first map is made with: the ones saved, as New World last left them. */
    const savedGeneration = () => Object.fromEntries(MAP_GENERATION.map((id) => [id, setting(id, saved())]));

    /** Saves over RCON and waits for the server to say the save is written. */
    async function save() {
        if (ctx.state.serverStatus !== "online") throw new Error("Start Factorio before saving");
        const before = local.saves;
        const reply = await rcon().exec("/server-save");
        if (!/Saving the map/.test(reply)) throw new Error(`Factorio didn't save: ${reply.trim() || "it gave no reason"}`);
        await waitUntil(() => local.saves > before, 120_000, "Factorio to finish saving");
    }

    /** Puts a player on a list or takes them off: over RCON while the server keeps the list, in its file otherwise. */
    async function setList(list: FactorioList, name: string, on: boolean) {
        const running = settled(ctx, "Factorio");
        // the whitelist is the server's only while it plays with one
        const serverKeeps = running && (list !== "whitelist" || setting("whitelist", saved()) === true);
        if (!serverKeeps) { await lists().set(list, name, on, BAN_REASON); return; }
        const command = {
            admins: on ? `/promote ${name}` : `/demote ${name}`,
            bans: on ? `/ban ${name} ${BAN_REASON}` : `/unban ${name}`,
            whitelist: on ? `/whitelist add ${name}` : `/whitelist remove ${name}`,
        }[list];
        const reply = (await rcon().exec(command)).trim();
        // /promote and /demote answer nothing; the others say what they did, or why not
        if (/doesn't exist|is not|isn't|not found|cannot|can't/i.test(reply)) throw new Error(`Factorio refused: ${reply}`);
        if (players.online().length > 0) await players.poll();
    }

    const install = (() => {
        let running: Promise<void> | null = null;
        return () => running ??= exclusive(ctx, local, "Factorio", async () => {
            assertHost(factorio);
            await installRelease(ctx, newestRelease.version, run);
            await ctx.updateSettings({ configured: true, version: newestRelease.version });
            await loadOptions();
        }).finally(() => { running = null; });
    })();

    async function releaseStatus() {
        const installed = (await installedRelease(await installDir()))?.version ?? null;
        return { installed, latest: newestRelease.version, updateAvailable: installed !== null && installed !== newestRelease.version };
    }

    return {
        primaryProcessId: PROC, processIds: [PROC],
        backupExclude: ["install"],
        backupSkip: [RUN_SETTINGS],
        updateStatus: releaseStatus,
        installUpdate: install,
        initialState: () => ({ ...initialServerState(), serverSoftware: GAME, serverPort: String(FACTORIO_DEFAULT_PORT), serverMotd: "" }),
        blocks: async () => {
            const { mergeBlocks, playerEvents, rosterBlocks, runGameCall } = await import("../../service/blocks");
            const player = { type: "player", name: "Player" } as const;
            const listCommand = (id: string, name: string, icon: string, description: string, text: string, list: "admins" | "whitelist", on: boolean) => ({
                id, name, category: "Players", icon, description, text, inputs: { player },
                run: ({ player: named }: { player: string }) => runGameCall(ctx, "factorioList", { list, name: named, on }),
            });
            const listValue = (id: string, name: string, icon: string, description: string, list: "admins" | "whitelist") => ({
                id, name, category: "Players", icon, description, type: "list<player>", read: () => lists().names(list),
            });
            return mergeBlocks({ events: playerEvents() }, rosterBlocks({
                kick: (name) => runGameCall(ctx, "factorioKick", { name }),
                ban: (name) => runGameCall(ctx, "factorioBan", { name }),
                unban: (name) => runGameCall(ctx, "factorioUnban", { name }),
                banned: async () => (await lists().bans()).map((ban) => ban.name),
            }), {
                commands: [
                    listCommand("make-admin", "Make Admin", "shield_person", "Makes a player an admin: they can kick, ban and run the server's commands", "Make {player} an admin", "admins", true),
                    listCommand("remove-admin", "Remove Admin", "remove_moderator", "Takes a player's admin rights away", "Remove {player} as an admin", "admins", false),
                    listCommand("whitelist-player", "Whitelist Player", "how_to_reg", "Adds a player to the whitelist, which decides who joins while Whitelist is on in Options", "Whitelist {player}", "whitelist", true),
                    listCommand("unwhitelist-player", "Remove From Whitelist", "person_off", "Takes a player off the whitelist", "Remove {player} from the whitelist", "whitelist", false),
                ],
                values: [
                    listValue("admins", "Admins", "shield_person", "The players on Factorio's admin list", "admins"),
                    listValue("whitelisted-players", "Whitelisted Players", "how_to_reg", "The players on Factorio's whitelist", "whitelist"),
                ],
            });
        },
        calls: async () => { const { sharedCalls } = await import("../../service/calls"); return { ...sharedCalls,
            readGameOptions: async (ctx) => { await loadOptions(); return ctx.state.gameSettings; },
            writeGameOptions: async (ctx, { patch }) => {
                if (local.busy) throw new Error("Wait for the Factorio operation to finish");
                if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new Error("Options patch is required");
                const current: Record<string, unknown> = {};
                for (const option of options) if (option.kind !== "secret") current[option.id] = optionValue(option, saved());
                const next = validateOptions(options, "Factorio", patch, current);
                seedValue(next.seed);
                const nextToken = Object.hasOwn(patch, "token") ? String(patch.token) : await token.value();
                const problem = publicProblem(next, nextToken);
                if (problem) throw new Error(problem);
                if (Object.hasOwn(patch, "password")) await joinPassword.set(singleLine(String(patch.password), "Join password"));
                if (Object.hasOwn(patch, "token")) await token.set(singleLine(String(patch.token), "Token"));
                const panel: Record<string, unknown> = {};
                for (const option of options) if (option.kind !== "secret" && Object.hasOwn(patch, option.id)) panel[option.id] = next[option.id];
                if (Object.keys(panel).length > 0) await ctx.updateSettings(panel);
                await loadOptions();
                return ctx.state.gameSettings;
            },
            factorioRelease: async () => ({ host: hostSupportHere(factorio), ...(await releaseStatus()), size: newestRelease.size }),
            factorioInstall: async () => { await install(); return true; },
            factorioStatus: async () => {
                const online = ctx.state.serverStatus === "online";
                const mods = await unlessMissing(fs.readFile(await modList(), "utf8"), null);
                return {
                    world: activeName(),
                    // a start matches the mods to its map; before the first, the next map's choice
                    spaceAge: mods === null ? setting("spaceAge", saved()) !== false : spaceAgeOn(mods),
                    evolution: online ? parseEvolution(await rcon().exec("/evolution")) : null,
                };
            },
            factorioWorlds: async () => listWorlds(await dataDir(), activeName()),
            factorioWorld: (ctx, { name, create, generation }) => exclusive(ctx, local, "Factorio", async () => {
                const checked = saveName(name);
                if (create) {
                    const chosen = { ...savedGeneration(), ...(generation ?? {}) };
                    // what New World was last set to is what it opens on next time
                    const kept = validateOptions(options.filter((o) => MAP_GENERATION.includes(o.id)), "Factorio", chosen, savedGeneration());
                    seedValue(kept.seed);
                    await createWorld(checked, kept);
                    await ctx.updateSettings({ ...kept, save: checked });
                } else {
                    if (!(await exists(saveFile(await dataDir(), checked)))) throw new Error(`There is no world named "${checked}"`);
                    await ctx.updateSettings({ save: checked });
                }
                return true;
            }),
            factorioWorldDelete: (ctx, { name }) => exclusive(ctx, local, "Factorio", async () => {
                await trashWorld(await ctx.root(), await dataDir(), name);
                if (activeName() === name) await ctx.updateSettings({ save: null });
                return true;
            }),
            factorioWorldInspect: async (ctx, { file }) => inspectUpload(await ctx.root(), await dataDir(), file),
            factorioWorldImport: (ctx, { file, name }) => exclusive(ctx, local, "Factorio", async () => {
                await importUpload(await ctx.root(), await dataDir(), file, name);
                // the first world there is is the one a start plays
                if (activeName() === null) await ctx.updateSettings({ save: saveName(name) });
                return true;
            }),
            factorioWorldDiscard: async (ctx, { file }) => { await discardUpload(await ctx.root(), file); return true; },
            factorioPlayers: async () => ({
                seen: await lists().seen(),
                online: players.online().map((p) => p.name),
                admins: await lists().names("admins"),
                bans: await lists().bans(),
                whitelist: await lists().names("whitelist"),
                whitelistOn: setting("whitelist", saved()) === true,
            }),
            factorioKick: async (ctx, { name }) => {
                const who = playerName(name);
                if (!settled(ctx, "Factorio") || !players.online().some((p) => p.name.toLowerCase() === who.toLowerCase())) throw new Error("That player is not online");
                const reply = (await rcon().exec(`/kick ${who} Kicked by the server admin`)).trim();
                if (/doesn't exist|isn't|is not/i.test(reply)) throw new Error(`Factorio refused: ${reply}`);
                await players.poll();
                return true;
            },
            factorioBan: async (ctx, { name }) => { await setList("bans", playerName(name), true); return true; },
            factorioUnban: async (ctx, { name }) => { await setList("bans", playerName(name), false); return true; },
            factorioList: async (ctx, { list, name, on }) => {
                if (list !== "admins" && list !== "whitelist") throw new Error("Choose the admin list or the whitelist");
                if (typeof on !== "boolean") throw new Error("Say whether the player goes on the list or off it");
                await setList(list, playerName(name), on);
                return true;
            },
        }; },
        loadOptions,
        async initialize(running) {
            const root = await ctx.root();
            local.lists = new FactorioLists(root, await dataDir());
            // an install or a tool cut short by a restart of the service
            await stopLeftoverInstaller(ctx.process, undefined, undefined, toolProcessId(ctx));
            await recoverRelease(await installDir());
            if (running) {
                // reattaching to a running server: talk to it with the password it started with
                const password = await rconPassword.value();
                if (!password) throw new Error("Factorio is running without the RCON password Paperboard set; stop it from the computer and start it again here");
                connect(ctx.runPort("factorio-rcon", Number(saved().rconPort ?? DEFAULT_RCON_PORT)), password);
                local.secrets = [password, await joinPassword.value(), await token.value()].filter(Boolean);
                local.inGame = true;
                players.start(true);
            } else {
                // a server that stopped while Paperboard was closed left its secrets behind
                await scrubPlayerData();
            }
        },
        async beforeRemove() { if (local.busy) throw new Error("Wait for Factorio's current operation"); },
        async dispose() {
            players.stop();
            local.rcon?.close();
            local.rcon = null;
            local.console.dispose();
        },
        async prepareLaunch() {
            assertHost(factorio);
            const release = await requireInstalled();
            const password = await joinPassword.value();
            const factorioToken = await token.value();
            const problem = publicProblem(saved(), factorioToken);
            if (problem) throw new Error(problem);
            const data = await dataDir();
            await fs.mkdir(savesDir(data), { recursive: true });

            // the map a start plays: the one chosen, or a first one, made now
            let world = activeName();
            if (world === null) {
                if ((await listWorlds(data, null)).length > 0) throw new Error("Choose the world to play in Worlds");
                await createWorld(FIRST_WORLD, savedGeneration());
                await ctx.updateSettings({ save: FIRST_WORLD });
                world = FIRST_WORLD;
            }
            const file = saveFile(data, world);
            if (!(await exists(file))) throw new Error(`The world ${world} is gone from the saves folder; choose another in Worlds`);
            // the mods are matched to the map: loading a map without its mods would strip them from it as it saves
            await tool(["--sync-mods", file], `match its mods to ${world}`, /^Mods synced$/);

            const rconSecret = await rconPassword.ensure();
            const rconPort = ctx.runPort("factorio-rcon", Number(saved().rconPort ?? DEFAULT_RCON_PORT));
            const settingsFile = path.join(data, RUN_SETTINGS);
            await writePrivate(settingsFile, JSON.stringify(serverSettings(saved(), { password, token: factorioToken }), null, 2));
            connect(rconPort, rconSecret);
            local.secrets = [rconSecret, password, factorioToken].filter(Boolean);
            local.inGame = false;
            local.saves = 0;
            players.stop();

            const list = (name: keyof typeof LIST_FILES) => lists().file(name);
            const args = [
                "-c", await configFile(),
                "--start-server", file,
                "--server-settings", settingsFile,
                "--port", String(ctx.runPort(GAME, Number(setting("port", saved())))),
                // the remote console answers this computer only
                "--rcon-bind", `127.0.0.1:${rconPort}`, "--rcon-password", rconSecret,
                "--server-adminlist", list("admins"), "--server-banlist", list("bans"),
                ...(setting("whitelist", saved()) === true ? ["--use-server-whitelist", "--server-whitelist", list("whitelist")] : []),
            ];
            return {
                message: `Starting Factorio ${release.version} with ${world}…`,
                command: { executable: executableIn(await installDir()), args, cwd: data, env: {} },
            };
        },
        async afterStop() {
            local.rcon?.close();
            local.rcon = null;
            local.inGame = false;
            await fs.rm(path.join(await dataDir(), RUN_SETTINGS), { force: true });
            await scrubPlayerData();
        },
        isMutating: () => local.busy,
        // a big map takes a while to load; the console shows it working
        readiness: { timeoutMs: 15 * 60_000, async probe() {
            // the server hosts the map, then opens its remote console
            if (!local.inGame) return false;
            let reply: string;
            try { reply = await rcon().exec("/version"); }
            catch (err) { if (err instanceof RconNoAnswer) return false; throw err; }
            const version = reply.trim();
            ctx.setState({ serverVersion: version });
            if (version && ctx.settings.version !== version) await ctx.updateSettings({ version });
            players.start();
            return true;
        } },
        saveWorld: save,
        stopTimeoutMs: 120_000, stopEntry: "Stopping: Factorio saves the map as it quits",
        // Ctrl+C: the server saves its map, then quits
        stop: () => ctx.process.kill(PROC, "SIGINT"),
        commandLine(command) {
            if (/[\r\n\0]/.test(command)) throw new Error("A command must be a single line");
            if (/^\s*\/(?:quit|config\s+set\s+password)\b/i.test(command)) throw new Error("Paperboard stops the server and keeps its join password; use Stop and Options");
            return command.trim();
        },
        async sendCommand(command) {
            // the answer comes back over the remote console, not through the server's own output
            const reply = await rcon().exec(command);
            for (const line of reply.split(/\r?\n/)) if (line.trim()) local.console.push(ctx, redact(line, local.secrets));
        },
        async sendChat(message) {
            const text = singleLine(message, "Message");
            // a line that starts with / is a command to the server, not chat
            if (text.trimStart().startsWith("/")) throw new Error("A chat message can't start with /");
            // the server prints it back as chat from <server>, which is what the chat shows
            await rcon().exec(text);
        },
        observeLine(raw) {
            const line = redact(raw.replace(/\r/g, ""), local.secrets);
            if (!line.trim()) return;
            if (IN_GAME.test(line)) local.inGame = true;
            if (SAVED.test(line)) local.saves++;
            const version = VERSION.exec(line);
            if (version) ctx.setState({ serverVersion: version[1]! });
            const chat = CHAT.exec(line);
            if (chat) {
                const [, sender, content] = chat as unknown as [string, string, string];
                if (sender === "<server>") pushChat(ctx, { event: "server", content, text: `<Server> ${content}` });
                else ctx.trigger(TRIGGER_IDS.chatMessage, pushChat(ctx, { sender, content, text: `<${sender}> ${content}` }));
            }
            local.console.push(ctx, line);
        },
        async assertFileAccess(file, write) {
            if (typeof file !== "string") throw new Error("Choose a file");
            if (file === `${DATA}/${RUN_SETTINGS}`) throw new Error("This file holds the join password while the server runs; change it in Options");
            if (file === `${DATA}/${PLAYER_DATA}` && ctx.state.serverStatus !== "offline") throw new Error("Factorio keeps the join password and token in this file while it runs; open it once the server is stopped");
            if (write && (file === "install" || file.startsWith("install/"))) throw new Error("Installed Factorio files are managed by Versions");
            if (write && (local.busy || ctx.state.serverStatus !== "offline")) throw new Error("Stop Factorio before editing its files");
        },
        portNames: [GAME, "factorio-rcon"],
        async *ports() {
            yield { name: GAME, label: "Factorio", protocol: "udp", preferred: Number(setting("port", saved())) };
            yield settingPort({ name: "factorio-rcon", label: "Factorio remote console", protocol: "tcp", key: "rconPort", fallback: DEFAULT_RCON_PORT }, saved());
        },
        backup: offlineBackup(ctx, {
            name: "Factorio", processId: PROC, flag: () => local,
            announce: async () => { await rcon().exec("The server is stopping for a backup and will be back shortly."); },
            save,
            clean: async () => { await fs.rm(path.join(await dataDir(), RUN_SETTINGS), { force: true }); await scrubPlayerData(); },
            exitStamp: async () => String(local.saves),
        }),
    };
}
