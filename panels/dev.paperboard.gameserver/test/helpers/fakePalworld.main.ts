// A stand-in Palworld dedicated server, compiled by standIn.ts and placed as
// install/PalServer.sh. Like the real one it reads PalWorldSettings.ini as it
// starts and serves the REST API on RESTAPIPort with HTTP Basic auth (user
// "admin", AdminPassword). Its behaviour comes from fake-palworld.json in
// its working directory: { "exitAfterStart": code } exits once started;
// { "refuse": { "<endpoint>": "<reason>" } } answers that endpoint 500 with the reason.
import * as fs from "node:fs";
import * as path from "node:path";

const say = (line: string) => process.stdout.write(`${line}\n`);
const cwd = process.cwd();
const planFile = path.join(cwd, "fake-palworld.json");
const plan = fs.existsSync(planFile) ? JSON.parse(fs.readFileSync(planFile, "utf8")) : {};
const ini = fs.readFileSync(path.join(cwd, "Pal", "Saved", "Config", "LinuxServer", "PalWorldSettings.ini"), "utf8");
const option = (key: string) => new RegExp(`[(,]${key}=("[^"]*"|[^,)]*)`).exec(ini)?.[1]?.replace(/^"|"$/g, "") ?? "";
const admin = option("AdminPassword");
const restPort = Number(option("RESTAPIPort"));
// what the game was started with, for the test to compare against the vault
fs.writeFileSync(path.join(cwd, "started-with.json"), JSON.stringify({ admin, join: option("ServerPassword"), args: process.argv.slice(2) }));
// Palworld names the world it runs in GameUserSettings.ini as it starts
fs.writeFileSync(path.join(cwd, "Pal", "Saved", "Config", "LinuxServer", "GameUserSettings.ini"), "[/Script/Pal.PalGameLocalSettings]\nDedicatedServerName=0123456789ABCDEF0123456789ABCDEF\n");
say("Game version is v0.6.1.0");
// a game that prints its own settings, as some log at debug level
say(`[LOG] Loaded settings: AdminPassword=${admin} ServerPassword=${option("ServerPassword")}`);
if (plan.exitAfterStart !== undefined) process.exit(plan.exitAfterStart);

const authorized = (req: Request) => req.headers.get("authorization") === `Basic ${Buffer.from(`admin:${admin}`).toString("base64")}`;
const json = (body: unknown) => Response.json(body);
Bun.serve({
    port: restPort,
    hostname: "127.0.0.1",
    async fetch(req) {
        if (!authorized(req)) return new Response("Unauthorized", { status: 401 });
        const endpoint = new URL(req.url).pathname.replace("/v1/api/", "");
        const refused = plan.refuse?.[endpoint];
        if (refused) return new Response(refused, { status: 500 });
        switch (endpoint) {
            case "info":
                return json({ version: "v0.6.1.0", servername: "Fake", description: "", worldguid: "0" });
            case "metrics":
                return json({ currentplayernum: 0, maxplayernum: 32, serverfps: 60, serverfpsaverage: 60, serverframetime: 16, uptime: 1, days: 1, basecampnum: 0 });
            case "players":
                return json({ players: [] });
            case "announce":
            case "save":
                return new Response("OK");
            case "shutdown":
                say("Shutdown requested");
                setImmediate(() => process.exit(0));
                return new Response("OK");
            default:
                return new Response("Not found", { status: 404 });
        }
    },
});
say(`REST API listening on ${restPort}`);
