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

function server(): void {
    const cwd = process.cwd();
    fs.writeFileSync(path.join(cwd, "argv.json"), JSON.stringify(args));
    fs.appendFileSync(path.join(cwd, "runs.log"), `${process.pid}\n`);
    const plan = readJson(path.join(cwd, "fake-server.json"));
    const players: string[] = plan.players ?? [];
    log("Starting minecraft server version 1.21.1");
    log("Starting Minecraft server on *:25565");
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
            fs.appendFileSync(path.join(cwd, "commands.log"), `${command}\n`);
            // what the test waits on: the command reached the server
            say(`[fake] received: ${command}`);
            answer(command);
        }
    });
    function answer(command: string): void {
        const [verb, ...rest] = command.split(" ");
        switch (verb) {
            case "stop":
                if (plan.ignoreStop) return;
                log("Stopping the server");
                log("Stopping server");
                log("Saving players");
                log("Saving worlds");
                process.exit(0);
            case "list":
                log(`There are ${players.length} of a max of ${plan.maxPlayers ?? 20} players online: ${players.join(", ")}`);
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
                const [, , name, field, scale] = rest;
                const values: Record<string, number> = { Health: 15.5, foodLevel: 18, XpLevel: 7, XpP: 0.25 };
                if (field === "Pos") log(`${name} has the following entity data: [1.5d, 64.0d, -3.25d]`);
                else if (field === "Dimension") log(`${name} has the following entity data: "minecraft:the_nether"`);
                else if (field && scale && field in values) log(`${field} on ${name} after scale factor of ${scale} is ${Math.round(values[field]! * Number(scale))}`);
                return;
            }
            case "kick":
                log(`Kicked ${rest[0]}: ${rest.slice(1).join(" ") || "Kicked by an operator"}`);
                log(`${rest[0]} left the game`);
                return;
            case "say":
                log(`[Server] ${rest.join(" ")}`);
                return;
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
