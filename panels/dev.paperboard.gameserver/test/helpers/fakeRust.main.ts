// A stand-in Rust dedicated server, compiled by standIn.ts and placed as
// install/RustDedicated. Like the real one it takes its settings as
// "+name value" arguments, prints its whole command line, and serves the
// WebSocket remote console on rcon.port, where the password is the path. It
// answers the commands Paperboard sends as build 26498655 does: every frame
// of an answer carries the command's Identifier, a log frame (Identifier 0)
// may come in between, and a command it doesn't know gets nothing. Its
// behaviour comes from fake-rust.json in its working directory:
// { "noSave": true } answers a save without writing the file.
import * as fs from "node:fs";
import * as path from "node:path";

const say = (line: string) => process.stdout.write(`${line}\n`);
const cwd = process.cwd();
const args = process.argv.slice(2);
const planFile = path.join(cwd, "fake-rust.json");
const plan = fs.existsSync(planFile) ? JSON.parse(fs.readFileSync(planFile, "utf8")) : {};
const setting = (name: string) => { const at = args.indexOf(`+${name}`); return at < 0 ? "" : args[at + 1] ?? ""; };
const password = setting("rcon.password");
const identity = path.join(cwd, "server", setting("server.identity"));
const saveFile = path.join(identity, `proceduralmap.${setting("server.worldsize")}.${setting("server.seed")}.290.sav`);
const bansFile = path.join(identity, "cfg", "bans.cfg");
fs.mkdirSync(path.dirname(bansFile), { recursive: true });
// what the game was started with, for the test to compare against the vault and the options
fs.writeFileSync(path.join(cwd, "started-with.json"), JSON.stringify({ args }));
say(`Command Line: ${["./RustDedicated", ...args].map((a) => `"${a}"`).join(" ")}`);

const bans = new Map<string, { name: string; reason: string }>();
if (fs.existsSync(bansFile)) for (const line of fs.readFileSync(bansFile, "utf8").split("\n")) {
    const match = /^banid (\d+) "(.*?)" "(.*)" -1$/.exec(line);
    if (match) bans.set(match[1]!, { name: match[2]!, reason: match[3]! });
}
const writeBans = () => fs.writeFileSync(bansFile, [...bans].map(([id, ban]) => `banid ${id} "${ban.name}" "${ban.reason}" -1\n`).join(""));
let maxPlayers = Number(setting("server.maxplayers") || 50);
let saves = 0;
const saveWorld = () => { if (!plan.noSave) fs.writeFileSync(saveFile, `save ${++saves} at ${process.hrtime.bigint()}`); };

Bun.serve<undefined, never>({
    port: Number(setting("rcon.port")),
    hostname: setting("rcon.ip"),
    fetch(req, server) {
        // the real server ends a connection that names the wrong password
        if (new URL(req.url).pathname !== `/${password}` || !server.upgrade(req, { data: undefined })) return new Response("", { status: 403 });
        return undefined;
    },
    websocket: {
        message(socket, raw) {
            const { Identifier, Message } = JSON.parse(String(raw)) as { Identifier: number; Message: string };
            const answer = (...messages: string[]) => { for (const m of messages) socket.send(JSON.stringify({ Message: m, Identifier, Type: "Generic", Stacktrace: "" })); };
            const log = (message: string) => socket.send(JSON.stringify({ Message: message, Identifier: 0, Type: "Generic", Stacktrace: "" }));
            let match: RegExpExecArray | null;
            log("Checking for new Steam Item Definitions..");
            if (Message === "serverinfo") answer(JSON.stringify({ Hostname: setting("server.hostname"), MaxPlayers: maxPlayers, Players: 0, Queued: 0, Joining: 0, EntityCount: 1849, Uptime: 44, Map: "Procedural Map", Framerate: 256, Memory: 434, Protocol: "2636.290.1" }, null, 2));
            else if (Message === "playerlist") answer("[]");
            else if (Message === "server.save") { saveWorld(); answer("Invalidate Network Cache took 0.00 seconds", "Saved 984 ents, cache(0.01), write(0.01), disk(0.00), navmesh(0.01).", "Saving complete", ""); }
            else if (Message === "server.writecfg") { writeBans(); answer("Config Saved"); }
            else if ((match = /^say (.*)$/.exec(Message))) {
                socket.send(JSON.stringify({ Message: JSON.stringify({ Channel: 2, Message: match[1], UserId: "0", Username: "SERVER", Color: "#eee", Time: 1 }, null, 2), Identifier: -1, Type: "Chat", Stacktrace: null }));
                answer("");
            } else if ((match = /^banid (\d+) "(.*?)" "(.*)"$/.exec(Message))) { bans.set(match[1]!, { name: match[2]!, reason: match[3]! }); answer(`Banned User: ${match[1]} - "${match[2]}" for "${match[3]}"`); }
            else if ((match = /^unban (\d+)$/.exec(Message))) answer(bans.delete(match[1]!) ? `Unbanned User: ${match[1]}` : `User ${match[1]} isn't banned`);
            else if (Message === "banlistex") answer([...bans].map(([id, ban], i) => `${i + 1} ${id} "${ban.name}" "${ban.reason}" -1\n`).join(""));
            else if (/^kick /.test(Message)) answer("Player not found");
            else if ((match = /^server\.maxplayers (\d+)$/.exec(Message))) { maxPlayers = Number(match[1]); answer(`server.maxplayers: "${maxPlayers}"`); }
            else if ((match = /^(server\.\w+) (.+)$/.exec(Message))) answer(`${match[1]}: ${match[2]}`);
            else if (Message === "status") answer(`hostname: ${setting("server.hostname")}\nversion : 2636 secure (secure mode enabled, connected to Steam3)\nmap     : Procedural Map\nplayers : 0 (${maxPlayers} max) (0 queued) (0 joining)\n\nid name ping connected addr owner violation kicks entityId \n`);
            else if (Message === "quit") {
                saveWorld();
                writeBans();
                answer("Saving complete", "Config Saved");
                say("[Raknet] Server Shutting Down (quit)");
                setImmediate(() => process.exit(0));
            }
            // anything else: the real server sends no frame for a command it doesn't know
        },
    },
});
say(`WebSocket RCON Started on ${setting("rcon.ip")}:${setting("rcon.port")}`);
say("Server startup complete");
