// A stand-in Factorio headless server, compiled by standIn.ts and placed as
// install/factorio/bin/x64/factorio. Like the real one (2.1.25, measured
// 2026-11-27) it reads write-data from the config.ini given with -c; makes
// a map with --create (a zip of one folder with level-init.dat), refusing a
// preset it doesn't have; turns mods on and off with --sync-mods to match a
// save, printing "Mods synced"; and with --start-server hosts the map: it
// binds its UDP port, prints "changing state from(CreatingGame) to(InGame)",
// then answers RCON on --rcon-bind, one packet a command, as the real one
// does. Its lists are the files it was given, written in lower case as they
// change. SIGINT saves the map, then it quits. Its log lines begin with the
// seconds since it started and its chat with the date, as the real server's do.
//
// A test plays players through files in the data folder (its working
// directory): names in fake-factorio-online.txt are online, and lines
// appended to fake-factorio-lines.txt are printed as the server's own. Its
// plan is fake-factorio.json there: { "noSaveOnExit": true } quits without
// saving.
import * as dgram from "node:dgram";
import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import { strToU8, unzipSync, zipSync } from "fflate";

const began = Date.now();
const say = (line: string) => process.stdout.write(`${((Date.now() - began) / 1000).toFixed(3).padStart(8)} ${line}\n`);
/** quits once what it printed is written out: a pipe's last lines are lost to an exit straight after them */
const quit = (code: number) => new Promise<never>(() => process.stdout.write("", () => process.exit(code)));
/** chat and the other game events print with the date alone, as the real server's do */
const event = (line: string) => process.stdout.write(`${new Date().toISOString().slice(0, 19).replace("T", " ")} ${line}\n`);
const args = process.argv.slice(2);
const arg = (name: string) => { const i = args.indexOf(name); return i === -1 ? undefined : args[i + 1]; };
const config = fs.readFileSync(arg("-c")!, "utf8");
const writeData = /^write-data=(.*)$/m.exec(config)![1]!;
const readData = /^read-data=(.*)$/m.exec(config)![1]!;
const planFile = path.join(writeData, "fake-factorio.json");
const plan = fs.existsSync(planFile) ? JSON.parse(fs.readFileSync(planFile, "utf8")) : {};
const modListFile = path.join(writeData, "mods", "mod-list.json");
const PRESETS = ["default", "rich-resources", "marathon", "death-world", "death-world-marathon", "rail-world", "ribbon-world", "lakes", "island"];
const runs = path.join(writeData, "fake-factorio-runs.json");
fs.writeFileSync(runs, JSON.stringify([...(fs.existsSync(runs) ? JSON.parse(fs.readFileSync(runs, "utf8")) : []), { args, cwd: process.cwd(), readData }]));
say(`${new Date().toISOString().slice(0, 19).replace("T", " ")}; Factorio 2.1.25 (build 88022, linux64, headless, space-age)`);

/** the mods a map was made with, kept in the stand-in's save beside its map */
const enabledMods = () => (fs.existsSync(modListFile) ? JSON.parse(fs.readFileSync(modListFile, "utf8")).mods.filter((m: { enabled: boolean }) => m.enabled).map((m: { name: string }) => m.name) : ["base", "elevated-rails", "quality", "recycler", "space-age"]);
function writeSave(file: string, mods: string[], saves: number) {
    const folder = path.basename(file, ".zip");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, zipSync({ [`${folder}/level-init.dat`]: strToU8(`map ${folder}`), [`${folder}/level.dat0`]: strToU8(`save ${saves}`), [`${folder}/fake-mods.json`]: strToU8(JSON.stringify(mods)) }));
}

const create = arg("--create");
if (create) {
    const preset = arg("--preset") ?? "default";
    if (!PRESETS.includes(preset)) {
        say(`Error CommandLineUtils.cpp:55: Preset "${preset}" doesn't exist.`);
        say("Goodbye");
        await quit(1);
    }
    say(`Info Create.cpp:32: Creating new map ${create}`);
    writeSave(create, enabledMods(), 0);
    fs.writeFileSync(path.join(writeData, `fake-made-${path.basename(create, ".zip")}.json`), JSON.stringify({ preset, seed: arg("--map-gen-seed") ?? null, mods: enabledMods() }));
    process.stdout.write("Done.\n");
    say("Goodbye");
    await quit(0);
}

const sync = arg("--sync-mods");
if (sync) {
    const folder = path.basename(sync, ".zip");
    const mods: string[] = JSON.parse(new TextDecoder().decode(unzipSync(fs.readFileSync(sync))[`${folder}/fake-mods.json`]!));
    const list = ["base", "elevated-rails", "quality", "recycler", "space-age"].map((name) => ({ name, enabled: mods.includes(name), version: "2.1.25" }));
    fs.mkdirSync(path.dirname(modListFile), { recursive: true });
    fs.writeFileSync(modListFile, JSON.stringify({ mods: list }, null, 2));
    process.stdout.write("Mods synced\n");
    say("Goodbye");
    await quit(0);
}

const map = arg("--start-server")!;
const lists = {
    admins: arg("--server-adminlist")!,
    bans: arg("--server-banlist")!,
    whitelist: args.includes("--use-server-whitelist") ? arg("--server-whitelist")! : null,
};
if (arg("--server-whitelist") && !args.includes("--use-server-whitelist")) {
    say("Error CommandLineMultiplayer.cpp:54: use-server-whitelist must be set when server-whitelist is set.");
    await quit(1);
}
fs.writeFileSync(path.join(writeData, "started-settings.json"), fs.readFileSync(arg("--server-settings")!, "utf8"));
// like the real one, it copies the token and the join password (in the clear) into player-data.json
const given = JSON.parse(fs.readFileSync(arg("--server-settings")!, "utf8"));
fs.writeFileSync(path.join(writeData, "player-data.json"), JSON.stringify({
    "service-username": given.username, "service-token": given.token, tips: { seen: [] },
    "last-played": { "host-settings": { "password-hash": given.game_password, "server-username": given.username, "autosave-interval": given.autosave_interval } },
}));
const read = (file: string): unknown[] => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : []);
const write = (file: string, entries: unknown[]) => fs.writeFileSync(file, `\n${JSON.stringify(entries, null, 2)}\n`);
for (const file of [lists.admins, lists.bans]) if (!fs.existsSync(file)) write(file, []);

let saves = Number(/save (\d+)/.exec(new TextDecoder().decode(unzipSync(fs.readFileSync(map))[`${path.basename(map, ".zip")}/level.dat0`] ?? new Uint8Array()))?.[1] ?? 0);
const mods: string[] = JSON.parse(new TextDecoder().decode(unzipSync(fs.readFileSync(map))[`${path.basename(map, ".zip")}/fake-mods.json`]!));
function save(how: "command" | "exit") {
    saves++;
    if (how === "command") say(`Info AppManager.cpp:424: Saving game as ${map}`);
    else say(`Info MainLoop.cpp:447: Saving map as ${map}`);
    writeSave(map, mods, saves);
    if (how === "command") say("Info AppManagerStates.cpp:2131: Saving finished");
    else say("Info MainLoop.cpp:458: Saving progress: 100.000000%");
}

const port = Number(arg("--port") ?? 34197);
const socket = dgram.createSocket("udp4");
socket.on("error", (err) => { say(`Error UDPSocket.cpp:102: ${err.message}`); void quit(1); });
socket.bind(port, "0.0.0.0");
say(`Loading map ${map}: 1024 bytes.`);
say(`Hosting game at IP ADDR:({0.0.0.0:${port}})`);
say("Info ServerMultiplayerManager.cpp:809: updateTick(0) changing state from(CreatingGame) to(InGame)");

const online = () => {
    const file = path.join(writeData, "fake-factorio-online.txt");
    return fs.existsSync(file) ? fs.readFileSync(file, "utf8").split("\n").filter(Boolean) : [];
};
const lower = (name: string) => name.toLowerCase();
const without = (entries: unknown[], name: string) => entries.filter((e) => lower(typeof e === "string" ? e : (e as { username: string }).username) !== lower(name));
function command(text: string): string {
    const [verb, ...rest] = text.trim().split(" ");
    const name = rest[0] ?? "";
    switch (verb) {
        case "/version": return "2.1.25\n";
        case "/players":
            return rest[0] === "online" ? `Online players (${online().length}):\n${online().map((n) => `  ${n} (online)\n`).join("")}` : `Players (${online().length}):\n`;
        case "/server-save": setTimeout(() => save("command"), 20); return "Saving the map\n";
        case "/evolution": return "[planet=nauvis] Nauvis - Evolution factor: 0.1234. (Time 3%) (Pollution 90%) (Spawner kills 7%)\n";
        case "/promote": write(lists.admins, [...without(read(lists.admins), name), lower(name)]); event(`[PROMOTE] ${name} was added to the admin list by <server>.`); return "";
        case "/demote": write(lists.admins, without(read(lists.admins), name)); return "";
        case "/ban": write(lists.bans, [...without(read(lists.bans), name), { username: lower(name), reason: rest.slice(1).join(" ") }]); return `Added ${name} to the banlist.\n`;
        case "/unban": write(lists.bans, without(read(lists.bans), name)); return `Unbanned ${name}.\n`;
        case "/whitelist":
            if (!lists.whitelist) return "The whitelist is not in use.\n";
            if (rest[0] === "add") { write(lists.whitelist, [...without(read(lists.whitelist), rest[1]!), lower(rest[1]!)]); return `Added ${rest[1]} to the whitelist.\n`; }
            if (rest[0] === "remove") { write(lists.whitelist, without(read(lists.whitelist), rest[1]!)); return `Removed ${rest[1]} from the whitelist.\n`; }
            return "The whitelist is empty.\n";
        case "/kick": return online().some((n) => lower(n) === lower(name)) ? "" : `Player ${name} doesn't exist.\n`;
        default:
            if (verb?.startsWith("/")) return `Unknown command "${verb.slice(1)}".\n`;
            event(`[CHAT] <server>: ${text}`);
            return "";
    }
}

// RCON: Source's packets, one reply packet a command and nothing mirrored, as Factorio answers
const rconBind = arg("--rcon-bind")!;
const [rconHost, rconPort] = [rconBind.slice(0, rconBind.lastIndexOf(":")), Number(rconBind.slice(rconBind.lastIndexOf(":") + 1))];
const packet = (id: number, type: number, body: string) => {
    const text = Buffer.from(body, "utf8");
    const out = Buffer.alloc(14 + text.length);
    out.writeInt32LE(10 + text.length, 0);
    out.writeInt32LE(id, 4);
    out.writeInt32LE(type, 8);
    text.copy(out, 12);
    return out;
};
setTimeout(() => {
    net.createServer((client) => {
        let buffer = Buffer.alloc(0);
        let authed = false;
        client.on("data", (chunk) => {
            buffer = Buffer.concat([buffer, chunk]);
            while (buffer.length >= 4 && buffer.length >= 4 + buffer.readInt32LE(0)) {
                const size = buffer.readInt32LE(0);
                const id = buffer.readInt32LE(4);
                const type = buffer.readInt32LE(8);
                const body = buffer.subarray(12, 4 + size - 2).toString("utf8");
                buffer = buffer.subarray(4 + size);
                if (type === 3) { authed = body === arg("--rcon-password"); client.write(packet(authed ? id : -1, 2, "")); continue; }
                if (!authed) { client.destroy(); return; }
                if (type === 2) client.write(packet(id, 0, command(body)));
            }
        });
    }).listen(rconPort, rconHost, () => say(`Info RemoteCommandProcessor.cpp:119: Starting RCON interface at IP ADDR:({${rconBind}})`));
}, 50);

// lines a test appends, printed as the server's own
const linesFile = path.join(writeData, "fake-factorio-lines.txt");
let printed = 0;
setInterval(() => {
    if (!fs.existsSync(linesFile)) return;
    const lines = fs.readFileSync(linesFile, "utf8").split("\n").filter(Boolean);
    for (const line of lines.slice(printed)) process.stdout.write(`${line}\n`);
    printed = lines.length;
}, 50);

process.on("SIGINT", () => {
    say("Received SIGINT, shutting down");
    if (!plan.noSaveOnExit) save("exit");
    socket.close();
    say("Goodbye");
    void quit(0);
});
