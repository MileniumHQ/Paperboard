// A stand-in Counter-Strike 2 server, compiled by standIn.ts and placed as
// install/game/bin/linuxsteamrt64/cs2. Like the real one (build 26598758) it
// reads console commands on stdin and prints their answers, says its map is
// running with a "Host activate" line, and writes Valve's game log lines. Two
// commands are the test's own: `fake_connect <userid> <steamid> <name>` and
// `fake_disconnect <userid>` print the log lines of a player joining and
// leaving. Every command it reads is appended to commands.txt in the
// install folder.
import * as fs from "node:fs";
import * as path from "node:path";

const say = (line: string) => process.stdout.write(`${line}\n`);
const args = process.argv.slice(2);
const install = path.resolve(path.dirname(process.execPath), "..", "..", "..");
const cfg = path.join(install, "game", "csgo", "cfg");
const setting = (name: string) => args[args.indexOf(name) + 1] ?? "";
const stamp = "L 11/12/2026 - 18:51:36: ";
// what the game was started with, and the passwords it read, for the test to compare against the vault
const secrets = fs.readFileSync(path.join(cfg, "paperboard_secrets.cfg"), "utf8");
const password = /^sv_password "(.*)"$/m.exec(secrets)?.[1] ?? "";
fs.writeFileSync(path.join(install, "started-with.json"), JSON.stringify({ args, secrets, configs: Object.fromEntries(fs.readdirSync(cfg).filter((f) => f.endsWith(".cfg")).map((f) => [f, fs.readFileSync(path.join(cfg, f), "utf8")])) }));
const players = new Map<number, { steamId: string; name: string }>();
let map = setting("+map");

say(`Loading map "${map}"`);
say(`SV:  Spawn Server: ${map}`);
say(`Host activate: Loading (${map})`);

for await (const raw of console) {
    const line = raw.trim();
    fs.appendFileSync(path.join(install, "commands.txt"), `${line}\n`);
    let match: RegExpExecArray | null;
    if (line === "status") {
        say("----- Status -----");
        say("hostname : Fake");
        say(`players  : ${[...players.values()].filter((p) => p.steamId !== "BOT").length} humans, ${[...players.values()].filter((p) => p.steamId === "BOT").length} bots (0 max) (hibernating) (unreserved)`);
        say("---------players--------");
        say("  id     time ping loss      state   rate adr name");
        for (const [id, p] of players) say(p.steamId === "BOT" ? `   ${id}      BOT    0    0     active      0 '${p.name}'` : `   ${id}    01:02   45    0     active 786432 1.2.3.4:27005 '${p.name}'`);
        say("#end");
    } else if ((match = /^fake_connect (\d+) (\S+) (.+)$/.exec(line))) {
        players.set(Number(match[1]), { steamId: match[2]!, name: match[3]! });
        say(`${stamp}"${match[3]}<${match[1]}><${match[2]}><>" connected, address "1.2.3.4:27005"`);
    } else if ((match = /^(?:fake_disconnect|kickid) (\d+)/.exec(line))) {
        const p = players.get(Number(match[1]));
        if (!p) say(`userid "${match[1]}" not found`);
        else {
            players.delete(Number(match[1]));
            say(`${stamp}"${p.name}<${match[1]}><${p.steamId}><CT>" disconnected (reason "NETWORK_DISCONNECT_KICKED")`);
        }
    } else if ((match = /^say (.*)$/.exec(line))) {
        say(`[All Chat][Console (0)]: ${match[1]}`);
        say(`${stamp}"Console<0>" say "${match[1]}"`);
    } else if ((match = /^changelevel (\S+)$/.exec(line))) {
        map = match[1]!;
        say(`Host activate: Changelevel (${map})`);
    } else if (line === "sv_password") say(`sv_password = ${password}`);
    else if (line === "quit") {
        say("Host activate: Quitting");
        process.exit(0);
    } else if (/^\w+$/.test(line)) say(`Unknown command '${line}'!`);
}
