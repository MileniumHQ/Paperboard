// A stand-in Terraria dedicated server, compiled by standIn.ts and placed as
// the install's Linux/TerrariaServer.bin.x86_64. It behaves as 1.4.5.8 does
// when run: it reads the -config file it is given, makes the world it names
// when there is none and autocreate is set (and asks for a world on the
// console when it is not), prints "Listening on port" before it binds the
// port and aborts when the port is taken, prints ": " as its console prompt
// and answers console commands. `save` backs the world up to .bak and writes
// it again, and `exit` writes it before the process ends. It also echoes its
// settings as a chatty mod would, so the console must hide the password.
// What it was started with goes to started-with.json in its working directory (the install).
// `relay <text>` prints <text> as if the game had: how a test makes a player speak.
// A relayed join or leave changes who `playing` lists, `kick` disconnects one,
// and `ban` writes them to the banlist before it does.
import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import { terrariaWorld } from "./terrariaWorld";

const args = process.argv.slice(2);
const configFile = args[args.indexOf("-config") + 1]!;
const config = Object.fromEntries(
    fs.readFileSync(configFile, "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => [l.slice(0, l.indexOf("=")).toLowerCase(), l.slice(l.indexOf("=") + 1)]),
);
fs.writeFileSync(path.join(process.cwd(), "started-with.json"), JSON.stringify({ password: config.password ?? "" }));
const say = (line: string) => process.stdout.write(`${line}\n`);
const prompt = () => process.stdout.write(": ");
const worldFile = config.world!;
let saves = 0;
/** the world as Terraria writes it: a header naming it, then what changed since */
const writeWorld = () => fs.writeFileSync(worldFile, Buffer.concat([terrariaWorld(config.worldname ?? path.basename(worldFile, ".wld"), config.seed || "12345"), Buffer.from(`save ${++saves}`)]));

// every start opens with byte order marks before its first line
say("﻿﻿﻿﻿Error Logging Enabled.");
say("Terraria Server v1.4.5.8");
say("");
if (!fs.existsSync(worldFile)) {
    if (!config.autocreate) {
        // no world and none to make: the world menu waits on the console
        say("1\t\tNew World");
        say("d <number>\tDelete World");
        say("");
        process.stdout.write("Choose World: ");
        setInterval(() => undefined, 1 << 30);
    } else {
        say(`Creating world - Seed: ${config.seed || "12345"}, Width: 4200, Height: 1200, Evil: -1, Difficulty: ${config.difficulty ?? 0}`);
        say("Resetting game objects 100%");
        say("100.0% - Final clean up - 100.0%");
        fs.mkdirSync(path.dirname(worldFile), { recursive: true });
        writeWorld();
    }
}
if (fs.existsSync(worldFile)) start();

function start(): void {
    say(`Loaded config: world=${config.worldname} password=${config.password}`);
    say("Terraria Server v1.4.5.8");
    say("");
    // said before the port is bound: a taken port aborts after it
    say(`Listening on port ${config.port ?? 7777}`);
    const listener = net.createServer((socket) => socket.destroy());
    listener.once("error", (err) => {
        say(`* Assertion at exception.c:109, condition \`is_ok (error)' not met (${err.message})`);
        say("Got a SIGABRT while executing native code.");
        process.exit(134);
    });
    listener.listen(Number(config.port ?? 7777), "127.0.0.1", () => {
        say("Type 'help' for a list of commands.");
        say("");
        // the prompt comes first, then the line: ": Server started"
        prompt();
        say("Server started");
        readConsole();
    });
}

function readConsole(): void {
    const players: string[] = [];
    const leave = (name: string) => {
        const at = players.indexOf(name);
        if (at < 0) return;
        players.splice(at, 1);
        say(`${name} has left.`);
    };
    let pending = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk: string) => {
        pending += chunk;
        let at: number;
        while ((at = pending.indexOf("\n")) >= 0) {
            const command = pending.slice(0, at).trim();
            pending = pending.slice(at + 1);
            const [verb, ...rest] = command.split(" ");
            if (verb === "exit") {
                say("Saving before exit...");
                writeWorld();
                process.exit(0);
            }
            if (verb === "save") {
                fs.copyFileSync(worldFile, `${worldFile}.bak`);
                say("Backing up world file");
                writeWorld();
            } else if (verb === "playing") {
                players.forEach((name, i) => say(`${name} (127.0.0.1:${50000 + i})`));
                say(players.length === 0 ? "No players connected." : `${players.length} player${players.length === 1 ? "" : "s"} connected.`);
            } else if (verb === "say") say(`<Server> ${rest.join(" ")}`);
            else if (verb === "kick") leave(rest.join(" "));
            else if (verb === "ban") {
                const name = rest.join(" ");
                const i = players.indexOf(name);
                if (i >= 0) {
                    fs.appendFileSync(config.banlist!, `//${name}\n127.0.0.1\n`);
                    leave(name);
                }
            } else if (verb === "relay") {
                const text = rest.join(" ");
                const joined = text.match(/^(.+) has joined\.$/);
                if (joined && !players.includes(joined[1]!)) players.push(joined[1]!);
                say(text);
            }
            prompt();
        }
    });
}
