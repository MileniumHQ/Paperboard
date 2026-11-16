// A stand-in `java`, compiled to a native executable by fakeJava.ts. It is
// what the panel launches as the server's Java runtime, so every console
// line below is real process output read through the real daemon.
//
// `java ... --installServer <dir>`: a Forge/NeoForge installer. Its
// behaviour comes from <JAVA_HOME>/installer.json.
// Anything else: a Minecraft server in its working directory. It records its
// argv in argv.json there, takes its behaviour from fake-server.json there,
// prints the lines Minecraft prints and answers the console commands the
// panel sends the way Minecraft does.
import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";

const args = process.argv.slice(2);
const say = (line: string) => process.stdout.write(`${line}\n`);
const log = (line: string) => say(`[12:00:00] [Server thread/INFO]: ${line}`);

function readJson(file: string): Record<string, any> {
    if (!fs.existsSync(file)) return {};
    return JSON.parse(fs.readFileSync(file, "utf8"));
}

function installer(outDir: string): void {
    const home = process.env.JAVA_HOME;
    if (!home) throw new Error("fake installer: JAVA_HOME is not set");
    const plan = readJson(path.join(home, "installer.json"));
    const build: string = plan.build ?? "21.1.256";
    say(`JVM info: Fake - 21`);
    say(`Target Directory: ${outDir}`);
    if (plan.mode === "hang") {
        // an installer that will not stop when asked
        process.on("SIGTERM", () => say("ignoring SIGTERM"));
        fs.writeFileSync(path.join(home, "installer.pid"), String(process.pid));
        say("Extracting libraries...");
        setInterval(() => undefined, 1 << 30);
        return;
    }
    if (plan.mode === "fail") {
        say("Downloading library from https://maven.neoforged.net/...");
        say("Failed to download library: connection reset");
        say("There was an error during installation");
        process.exit(1);
    }
    const write = (rel: string, content: string) => {
        const file = path.join(outDir, ...rel.split("/"));
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, content);
    };
    write("user_jvm_args.txt", "# Xmx and other JVM args\n");
    if (plan.mode === "empty") {
        say("The server installed successfully");
        process.exit(0);
    }
    // the layout NeoForge 21.1.256's installer writes
    const lib = `libraries/net/neoforged/neoforge/${build}`;
    write(`${lib}/unix_args.txt`, `-p libraries/a.jar:libraries/b.jar\n--launchTarget forgeserver\n`);
    write(`${lib}/win_args.txt`, `-p libraries/a.jar;libraries/b.jar\n--launchTarget forgeserver\n`);
    write(`${lib}/neoforge-${build}-server.jar`, "server");
    write("libraries/net/minecraft/server/1.21.1/server-1.21.1.jar", "minecraft");
    write("run.sh", `#!/usr/bin/env sh\njava @user_jvm_args.txt @${lib}/unix_args.txt "$@"\n`);
    write("run.bat", `java @user_jvm_args.txt @${lib}/win_args.txt %*\n`);
    for (const extra of plan.extra ?? []) write(extra, "installer output");
    say("The server installed successfully");
    process.exit(0);
}

// what Minecraft 1.21.1 fills in for every key server.properties leaves out
const PROPERTY_DEFAULTS: Record<string, string> = {
    "accepts-transfers": "false", "allow-flight": "false", "allow-nether": "true", "broadcast-console-to-ops": "true",
    "broadcast-rcon-to-ops": "true", "bug-report-link": "", difficulty: "easy", "enable-command-block": "false",
    "enable-jmx-monitoring": "false", "enable-query": "false", "enable-rcon": "false", "enable-status": "true",
    "enforce-secure-profile": "true", "enforce-whitelist": "false", "entity-broadcast-range-percentage": "100",
    "force-gamemode": "false", "function-permission-level": "2", gamemode: "survival", "generate-structures": "true",
    "generator-settings": "{}", hardcore: "false", "hide-online-players": "false", "initial-disabled-packs": "",
    "initial-enabled-packs": "vanilla", "level-name": "world", "level-seed": "", "level-type": "minecraft:normal",
    "log-ips": "true", "max-chained-neighbor-updates": "1000000", "max-players": "20", "max-tick-time": "60000",
    "max-world-size": "29999984", motd: "A Minecraft Server", "network-compression-threshold": "256", "online-mode": "true",
    "op-permission-level": "4", "player-idle-timeout": "0", "prevent-proxy-connections": "false", pvp: "true",
    "query.port": "25565", "rate-limit": "0", "rcon.password": "", "rcon.port": "25575", "region-file-compression": "deflate",
    "require-resource-pack": "false", "resource-pack": "", "resource-pack-id": "", "resource-pack-prompt": "",
    "resource-pack-sha1": "", "server-ip": "", "server-port": "25565", "simulation-distance": "10", "spawn-animals": "true",
    "spawn-monsters": "true", "spawn-npcs": "true", "spawn-protection": "16", "sync-chunk-writes": "true",
    "text-filtering-config": "", "use-native-transport": "true", "view-distance": "10", "white-list": "false",
};

/** java.util.Properties.load, for the lines Minecraft writes and people type */
function parseProperties(text: string): Record<string, string> {
    const values: Record<string, string> = {};
    const unescape = (raw: string) => raw.replace(/\\(u[0-9a-fA-F]{4}|.)/g, (_, c: string) =>
        c.length === 5 ? String.fromCharCode(parseInt(c.slice(1), 16)) : ({ t: "\t", n: "\n", r: "\r", f: "\f" } as Record<string, string>)[c] ?? c);
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.replace(/^\s+/, "");
        if (!line || line.startsWith("#") || line.startsWith("!")) continue;
        const end = /(?<!\\)(?:\\\\)*[=:\s]/.exec(line);
        const at = end ? end.index + end[0].length - 1 : line.length;
        values[unescape(line.slice(0, at))] = unescape(line.slice(at + 1).replace(/^\s*[=:]?\s*/, ""));
    }
    return values;
}

/** java.util.Properties.store through the UTF-8 writer Minecraft saves with: sorted, escaped, under a dated header */
function storeProperties(values: Record<string, string>): string {
    const escape = (text: string, isKey: boolean) => [...text].map((c, i) =>
        c === "\\" ? "\\\\" : c === "\t" ? "\\t" : c === "\n" ? "\\n" : c === "\r" ? "\\r" : c === "\f" ? "\\f"
        : "=:#!".includes(c) ? `\\${c}` : c === " " && (isKey || i === 0) ? "\\ " : c).join("");
    const lines = Object.keys(values).sort().map((key) => `${escape(key, true)}=${escape(values[key]!, false)}`);
    return `#Minecraft server properties\n#${new Date().toString()}\n${lines.join("\n")}\n`;
}

/** the uuid an offline-mode server gives a name: Java's UUID.nameUUIDFromBytes("OfflinePlayer:<name>") */
function offlineUuid(name: string): string {
    const bytes = createHash("md5").update(`OfflinePlayer:${name}`).digest();
    bytes[6] = (bytes[6]! & 0x0f) | 0x30;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    const hex = bytes.toString("hex");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Minecraft's stamp in its lists: "2026-11-15 16:40:48 -0800" */
function stamp(date: Date): string {
    const pad = (n: number) => String(Math.abs(n)).padStart(2, "0");
    const offset = -date.getTimezoneOffset();
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())} ${offset < 0 ? "-" : "+"}${pad(Math.trunc(offset / 60))}${pad(offset % 60)}`;
}

type Profile = { uuid: string; name: string };

function server(): void {
    const cwd = process.cwd();
    const file = (name: string) => path.join(cwd, name);
    const readText = (name: string) => (fs.existsSync(file(name)) ? fs.readFileSync(file(name), "utf8") : null);
    fs.writeFileSync(file("argv.json"), JSON.stringify(args));
    fs.appendFileSync(file("runs.log"), `${process.pid}\n`);
    const plan = readJson(file("fake-server.json"));
    const online: string[] = [...(plan.players ?? [])];
    // Minecraft reads server.properties once as it starts and saves it straight
    // back, with every key it knows filled in, before it even checks the EULA.
    // Paper and the servers built on it save --port into it too. A later save
    // (whitelist on/off) writes what was read then, not what the file has since.
    const portAt = args.indexOf("--port");
    const override = portAt >= 0 ? args[portAt + 1]! : null;
    const properties: Record<string, string> = { ...PROPERTY_DEFAULTS, ...parseProperties(readText("server.properties") ?? ""), ...(override === null ? {} : { "server-port": override }) };
    const saveProperties = () => fs.writeFileSync(file("server.properties"), storeProperties(properties));
    saveProperties();
    if (!/^eula=true$/m.test(readText("eula.txt") ?? "")) {
        if (readText("eula.txt") === null) {
            log("Failed to load eula.txt");
            fs.writeFileSync(file("eula.txt"), `#By changing the setting below to TRUE you are indicating your agreement to our EULA (https://aka.ms/MinecraftEULA).\n#${new Date().toString()}\neula=false\n`);
        }
        log("You need to agree to the EULA in order to run the server. Go to eula.txt for more info.");
        // the real one exits now; this one waits for the test to leave the file `eulaHold` names
        if (plan.eulaHold) setInterval(() => { if (fs.existsSync(file(plan.eulaHold))) process.exit(0); }, 20);
        else process.exit(0);
        return;
    }
    log("Starting minecraft server version 1.21.1");
    // its lists exist from here on, empty until something is put on them
    for (const list of ["ops.json", "whitelist.json", "banned-players.json", "banned-ips.json", "usercache.json"]) {
        if (readText(list) === null) fs.writeFileSync(file(list), "[]");
    }
    log(`Starting Minecraft server on *:${properties["server-port"]}`);
    if (plan.exitBeforeDone !== undefined) {
        // a chunk with no newline at the end: the last line arrives with the exit
        process.stdout.write("[12:00:00] [Server thread/ERROR]: Failed to start the minecraft server");
        process.exit(plan.exitBeforeDone);
    }
    if (plan.splitDone) {
        // one line in two writes, as a pipe may deliver it
        process.stdout.write('[12:00:01] [Server thread/INFO]: Done (1.234s)! For help, ');
        setImmediate(() => process.stdout.write('type "help"\n'));
    } else log('Done (1.234s)! For help, type "help"');
    if (plan.ignoreStop) process.on("SIGTERM", () => say("ignoring SIGTERM"));
    if (plan.closeStdin) {
        // a server that stopped reading its console: every write to it fails
        process.stdin.destroy();
        say("[fake] console closed");
        setInterval(() => undefined, 1 << 30);
        return;
    }
    let pending = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk: string) => {
        pending += chunk;
        let newline: number;
        while ((newline = pending.indexOf("\n")) >= 0) {
            const command = pending.slice(0, newline).trim();
            pending = pending.slice(newline + 1);
            fs.appendFileSync(file("commands.log"), `${command}\n`);
            // what the test waits on: the command reached the server
            say(`[fake] received: ${command}`);
            answer(command);
        }
    });

    const readList = <T extends Profile>(name: string): T[] => JSON.parse(readText(name) ?? "[]");
    const writeList = (name: string, entries: unknown[]) => fs.writeFileSync(file(name), JSON.stringify(entries, null, 2));
    const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
    /** the profile a command names, as Minecraft finds it: its name book, else an offline-mode server's own uuid; online, Mojang (none here) */
    function profile(name: string): Profile | null {
        const known = readList("usercache.json").find((entry) => same(entry.name, name));
        if (known) return { uuid: known.uuid, name: known.name };
        if (properties["online-mode"] !== "false") return null;
        const made = { uuid: offlineUuid(name), name };
        const expires = new Date(Date.now() + 30 * 24 * 3600_000);
        writeList("usercache.json", [{ ...made, expiresOn: stamp(expires) }, ...readList("usercache.json")]);
        return made;
    }
    /** a command that puts a profile on a list or takes it off; the list is written before the answer, as Minecraft does */
    function listCommand(list: string, name: string, on: boolean, entry: (found: Profile) => Record<string, unknown>, said: { done: string; already: string }): void {
        const found = profile(name);
        if (!found) {
            log("That player does not exist");
            return;
        }
        const entries = readList(list);
        const listed = entries.some((e) => e.uuid === found.uuid);
        if (listed === on) {
            log(said.already);
            return;
        }
        const changed = on ? [...entries, entry(found)] : entries.filter((e) => e.uuid !== found.uuid);
        if (!plan.listWriteMs) {
            writeList(list, changed);
            log(said.done.replace("%s", found.name));
            return;
        }
        // a slow write leaves the list cut short for `listWriteMs` before it ends
        const text = JSON.stringify(changed, null, 2);
        fs.writeFileSync(file(list), text.slice(0, Math.ceil(text.length / 2)));
        setTimeout(() => {
            fs.writeFileSync(file(list), text);
            log(said.done.replace("%s", found.name));
        }, plan.listWriteMs);
    }

    function answer(command: string): void {
        const [verb, ...rest] = command.split(" ");
        const name = rest[0] ?? "";
        switch (verb) {
            case "stop":
                if (plan.ignoreStop) return;
                log("Stopping the server");
                log("Stopping server");
                log("Saving players");
                log("Saving worlds");
                // a server slow to save: it exits once the test leaves this file
                if (plan.holdStop) setInterval(() => { if (fs.existsSync(file(plan.holdStop))) process.exit(0); }, 20);
                else process.exit(0);
                return;
            case "list":
                log(`There are ${online.length} of a max of ${plan.maxPlayers ?? properties["max-players"]} players online: ${online.join(", ")}`);
                return;
            case "save-off":
                log("Automatic saving is now disabled");
                return;
            case "save-on":
                log("Automatic saving is now enabled");
                return;
            case "save-all":
                if (plan.failFlush) {
                    log("Saving failed: disk full");
                    return;
                }
                log("Saving the game (this may take a moment!)");
                log("Saved the game");
                return;
            case "data": {
                // data get entity <name> <path> [scale]
                const [, , who, field, scale] = rest;
                const values: Record<string, number> = { Health: 15.5, foodLevel: 18, XpLevel: 7, XpP: 0.25 };
                if (!online.some((player) => same(player, who ?? ""))) log("No entity was found");
                else if (field === "Pos") log(`${who} has the following entity data: [1.5d, 64.0d, -3.25d]`);
                else if (field === "Dimension") log(`${who} has the following entity data: "minecraft:the_nether"`);
                else if (field && scale && field in values) log(`${field} on ${who} after scale factor of ${scale} is ${Math.round(values[field]! * Number(scale))}`);
                return;
            }
            case "kick": {
                const at = online.findIndex((player) => same(player, name));
                if (at < 0) {
                    log("No player was found");
                    return;
                }
                const [kicked] = online.splice(at, 1);
                const reason = rest.slice(1).join(" ") || "Kicked by an operator";
                log(`Kicked ${kicked}: ${reason}`);
                log(`${kicked} lost connection: ${reason}`);
                log(`${kicked} left the game`);
                return;
            }
            case "kill":
                log(online.some((player) => same(player, name)) ? `Killed ${online.find((player) => same(player, name))}` : "No entity was found");
                return;
            case "whitelist":
                if (rest[0] === "on" || rest[0] === "off") {
                    const wanted = String(rest[0] === "on");
                    if (properties["white-list"] === wanted) {
                        log(`Whitelist is already turned ${rest[0]}`);
                        return;
                    }
                    properties["white-list"] = wanted;
                    saveProperties();
                    log(`Whitelist is now turned ${rest[0]}`);
                } else if (rest[0] === "add" || rest[0] === "remove") {
                    const on = rest[0] === "add";
                    listCommand("whitelist.json", rest[1] ?? "", on, (found) => ({ ...found }), on
                        ? { done: "Added %s to the whitelist", already: "Player is already whitelisted" }
                        : { done: "Removed %s from the whitelist", already: "Player is not whitelisted" });
                }
                return;
            case "op":
            case "deop":
                listCommand("ops.json", name, verb === "op", (found) => ({ ...found, level: Number(properties["op-permission-level"]), bypassesPlayerLimit: false }), verb === "op"
                    ? { done: "Made %s a server operator", already: "Nothing changed. The player already is an operator" }
                    : { done: "Made %s no longer a server operator", already: "Nothing changed. The player is not an operator" });
                return;
            case "say":
                log(`[Not Secure] [Server] ${rest.join(" ")}`);
                return;
            case "ban":
            case "pardon": {
                const reason = rest.slice(1).join(" ");
                // a ban plugin's own words for a pardon, when the plan names them
                listCommand("banned-players.json", name, verb === "ban",
                    // no reason given: the list names none, and the answer gives Minecraft's default
                    (found) => ({ ...found, created: stamp(new Date()), source: "Server", expires: "forever", ...(reason ? { reason } : {}) }),
                    verb === "ban"
                        ? { done: `Banned %s: ${reason || "Banned by an operator."}`, already: "Nothing changed. The player is already banned" }
                        : { done: plan.pardonSays ?? "Unbanned %s", already: "Nothing changed. The player isn't banned" });
                return;
            }
            case "crash":
                process.exit(Number(rest[0] ?? 1));
            default:
                return;
        }
    }
}

const install = args.indexOf("--installServer");
if (install >= 0) installer(args[install + 1]!);
else server();
