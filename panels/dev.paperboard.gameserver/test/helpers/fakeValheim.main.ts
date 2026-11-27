// A stand-in Valheim dedicated server, compiled by standIn.ts and placed as
// install/valheim_server.x86_64. Like the real one (build 26949048, measured
// 2026-11-27) it binds its UDP port and the next, makes its three lists in
// -savedir, prints "Game server connected" once it is up (and, for a world it
// had to make, generates its locations after that), saves the world as
// SIGINT or SIGTERM ends it, and quits on a public server whose password it
// refuses. Each line starts with the time, as the real server's do. Lines a
// test appends to fake-valheim-lines.txt in its working directory are
// printed as the server's own, so a test plays joins and leaves. Its plan
// is fake-valheim.json there: { "noSaveOnExit": true } exits without saving;
// { "refusePassword": true } refuses a public server's password.
import * as dgram from "node:dgram";
import * as fs from "node:fs";
import * as path from "node:path";

const stamp = () => {
    const d = new Date();
    const two = (n: number) => String(n).padStart(2, "0");
    return `${two(d.getMonth() + 1)}/${two(d.getDate())}/${d.getFullYear()} ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
};
const say = (line: string) => process.stdout.write(`${stamp()}: ${line}\n`);
const cwd = process.cwd();
const planFile = path.join(cwd, "fake-valheim.json");
const plan = fs.existsSync(planFile) ? JSON.parse(fs.readFileSync(planFile, "utf8")) : {};
const args = process.argv.slice(2);
const arg = (name: string) => { const i = args.indexOf(name); return i === -1 ? undefined : args[i + 1]; };
fs.writeFileSync(path.join(cwd, "started-with.json"), JSON.stringify({ args, env: { LD_LIBRARY_PATH: process.env.LD_LIBRARY_PATH, SteamAppId: process.env.SteamAppId, HOME: process.env.HOME } }));

const port = Number(arg("-port") ?? 2456);
const world = arg("-world") ?? "Dedicated";
const saveDir = arg("-savedir")!;
say(`Setting -savedir to: ${saveDir}`);
for (const [file, comment] of [["adminlist.txt", "// List admin players ID  ONE per line"], ["bannedlist.txt", "// List banned players ID  ONE per line"], ["permittedlist.txt", "// List permitted players ID ONE per line"]]) {
    if (!fs.existsSync(path.join(saveDir, file!))) fs.writeFileSync(path.join(saveDir, file!), `${comment}\n`);
}
say("Valheim version: l-1.0.31 (network version 42)");
// the server checks a public server's password against the world's seed too, which only it knows
if (arg("-public") !== "0" && plan.refusePassword) {
    say("Error bad password:Password can't be in the world's name or seed");
    process.exit(0);
}

const worldDir = path.join(saveDir, "worlds_local", world);
const fresh = !fs.existsSync(worldDir);
let saves = 0;
function save() {
    saves++;
    fs.mkdirSync(worldDir, { recursive: true });
    for (const name of fs.readdirSync(worldDir)) fs.rmSync(path.join(worldDir, name));
    for (const ext of ["db2", "fwl2", "chunks", "ok"]) fs.writeFileSync(path.join(worldDir, `_main.${saves}.${ext}`), `${world} save ${saves}\n`);
    say(`World save (1/5) Cloud & Backup checks done [0ms] => Save number ${saves}`);
    say("World save (5/5) done. Total time [3ms]");
}

// the game port and the next, as the real server binds them
const sockets = [port, port + 1].map((p) => {
    const socket = dgram.createSocket("udp4");
    socket.on("error", (err) => { say(`Failed to bind ${p}: ${err.message}`); process.exit(1); });
    socket.bind(p, "0.0.0.0");
    return socket;
});
say(`Load world: ${world} (${world})`);
say("Game server connected");
if (fresh) {
    say("Loading: Generating locations");
    // the test reads the file: a start that came online before it was written came online too soon
    setTimeout(() => {
        fs.writeFileSync(path.join(cwd, "generated"), "");
        say("Loading: Done. Total seconds sinze ZNet start: 1.2, Genloc duration: 400 ms");
    }, 400);
}
if (arg("-crossplay") !== undefined) {
    setTimeout(() => {
        say(`Session "${arg("-name")}" registered with join code 150661`);
        say(`Session "${arg("-name")}" with join code 150661 and IP 203.0.113.7:${port} is active with 0 player(s)`);
    }, 50);
}

// lines a test appends, printed as the server's own
const linesFile = path.join(cwd, "fake-valheim-lines.txt");
let printed = 0;
setInterval(() => {
    if (!fs.existsSync(linesFile)) return;
    const lines = fs.readFileSync(linesFile, "utf8").split("\n").filter(Boolean);
    for (const line of lines.slice(printed)) say(line);
    printed = lines.length;
}, 50);

const quit = () => {
    say("Game - OnApplicationQuit");
    if (!plan.noSaveOnExit) save();
    for (const socket of sockets) socket.close();
    say("Net scene destroyed");
    process.exit(0);
};
process.on("SIGINT", quit);
process.on("SIGTERM", quit);
