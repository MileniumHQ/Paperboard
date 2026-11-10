// A stand-in Terraria dedicated server, compiled by standIn.ts and placed as
// the install's Linux/TerrariaServer.bin.x86_64. Like the real one it reads
// the -config file it is given, listens on its port, prints ": " as its
// console prompt and answers console commands. It also echoes its settings
// as a chatty mod would, so the console must hide the password.
// What it was started with goes to started-with.json in its working directory (the install).
// `relay <text>` prints <text> as if the game had: how a test makes a player speak.
import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";

const args = process.argv.slice(2);
const configFile = args[args.indexOf("-config") + 1]!;
const config = Object.fromEntries(
    fs.readFileSync(configFile, "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
fs.writeFileSync(path.join(process.cwd(), "started-with.json"), JSON.stringify({ password: config.password ?? "" }));
const say = (line: string) => process.stdout.write(`${line}\n`);
const prompt = () => process.stdout.write(": ");
say("Terraria Server v1.4.5.8");
say(`Loaded config: world=${config.worldname} password=${config.password}`);
const listener = net.createServer((socket) => socket.destroy());
listener.listen(Number(config.port ?? 7777), "127.0.0.1", () => {
    say(`Listening on port ${config.port}`);
    say("Type 'help' for a list of commands.");
    say("Server started");
    prompt();
});
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
            say("Saving world data: 100%");
            process.exit(0);
        }
        if (verb === "playing") say("No players connected.");
        else if (verb === "say") say(`<Server> ${rest.join(" ")}`);
        else if (verb === "relay") say(rest.join(" "));
        prompt();
    }
});
