// A stand-in SteamCMD, compiled by standIn.ts and placed where the panel
// keeps its SteamCMD (<files>/.steam/steamcmd). It reads its commands the
// way SteamCMD does ("+login anonymous +app_update 232250 validate +quit")
// and prints what SteamCMD prints for them. What it answers comes from
// fake-steamcmd.json in its folder:
//   appInfo: { "<appId>": "<file of real app_info_print output>" }
//   truncateInfo: true   prints only the first half of that output
//   install: { "<appId>": { build, mode: "ok" | "missing-config-once" | "fail" | "silent" | "other-app", reason?, files? } }
//   selfUpdateOnce: true exits 7 once, as SteamCMD on Windows does after updating itself
// Every run's arguments are appended to runs.log there.
import * as fs from "node:fs";
import * as path from "node:path";

const here = path.dirname(process.execPath);
const args = process.argv.slice(2);
const say = (line: string) => process.stdout.write(`${line}\n`);
const planFile = path.join(here, "fake-steamcmd.json");
const plan = fs.existsSync(planFile) ? JSON.parse(fs.readFileSync(planFile, "utf8")) : {};
fs.appendFileSync(path.join(here, "runs.log"), `${JSON.stringify(args)}\n`);

const commands: string[][] = [];
for (const arg of args) {
    if (arg.startsWith("+")) commands.push([arg.slice(1)]);
    else commands.at(-1)?.push(arg);
}
const once = (name: string) => {
    const marker = path.join(here, `.${name}`);
    if (fs.existsSync(marker)) return false;
    fs.writeFileSync(marker, "");
    return true;
};

say("Steam Console Client (c) Valve Corporation - version 1792617903");
if (plan.selfUpdateOnce && once("self-updated")) {
    say("[100%] Download Complete.");
    say("Update complete, launching...");
    process.exit(7);
}
let dir = here;
let code = 0;
for (const [command, ...rest] of commands) {
    switch (command) {
        case "force_install_dir":
            dir = rest[0]!;
            break;
        case "login":
            say("Connecting anonymously to Steam Public...\x1b[0mOK");
            break;
        case "app_info_print": {
            const file = plan.appInfo?.[rest[0]!];
            if (!file) {
                say(`No app info for ${rest[0]}`);
                break;
            }
            const lines = fs.readFileSync(file, "utf8").split("\n");
            for (const line of plan.truncateInfo ? lines.slice(0, Math.floor(lines.length / 2)) : lines) say(line);
            break;
        }
        case "app_update": {
            const appId = rest[0]!;
            const install = plan.install?.[appId] ?? { mode: "fail", reason: "No subscription" };
            if (install.mode === "missing-config-once" && once(`missing-config-${appId}`)) {
                say(`ERROR! Failed to install app '${appId}' (Missing configuration)`);
                code = 8;
                break;
            }
            if (install.mode === "fail") {
                say(`ERROR! Failed to install app '${appId}' (${install.reason ?? "No subscription"})`);
                code = 8;
                break;
            }
            say(` Update state (0x61) downloading, progress: 50.00 (5 / 10)`);
            say(` Update state (0x81) verifying update, progress: 100.00 (10 / 10)`);
            fs.mkdirSync(path.join(dir, "steamapps"), { recursive: true });
            fs.writeFileSync(path.join(dir, "steamapps", `appmanifest_${appId}.acf`), `"AppState"\n{\n\t"appid"\t\t"${appId}"\n\t"buildid"\t\t"${install.build}"\n}\n`);
            for (const [file, content] of Object.entries(install.files ?? {})) {
                fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
                fs.writeFileSync(path.join(dir, file), String(content));
            }
            // "other-app": a success line, but for an app that was not asked for
            if (install.mode === "other-app") say("Success! App '1007' fully installed.");
            else if (install.mode !== "silent") say(`Success! App '${appId}' fully installed.`);
            break;
        }
        case "quit":
            say("Unloading Steam API...\x1b[0mOK");
            break;
    }
}
process.exit(code);
