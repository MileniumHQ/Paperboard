#!/usr/bin/env node
// npx @mileniumhq/paperboard [command]
//
//   (nothing)   open Paperboard, installing it first if you say yes
//   web         open Paperboard in your browser (also --web)
//   install     install Paperboard, or update it to the latest release
//   serve ...   run the Paperboard server daemon (papercrane) in this terminal
//
// Any other command or flag goes to papercrane as is, so `pair`, `status`,
// `install-service` and `serve --port 45465` work as they always have. The
// launcher's own lines go to stderr, so `status --json` stays parseable.
import pkg from "../package.json";
import { askToInstall, findInstalledApp, installApp, openApp } from "./app";
import { DEFAULT_REGISTRY, ensureCrane, runCrane } from "./launcher";

const log = (line: string) => process.stderr.write(`${line}\n`);

const HELP = `Usage: npx @mileniumhq/paperboard [command]

  (no command)   open Paperboard, installing it first if you say yes
  web            open Paperboard in your browser
  install        install Paperboard, or update it to the latest release
  serve          run the Paperboard server daemon in this terminal

Other commands go to the server daemon: pair, status, install-service, and
more. See them with: npx @mileniumhq/paperboard serve --help
`;

async function openPaperboard(args: string[]): Promise<number> {
    let app = findInstalledApp();
    if (!app) {
        // installing is a big step for a command that reads as "open it"
        if (!process.stdin.isTTY) {
            throw new Error("Paperboard isn't installed. Install it with: npx @mileniumhq/paperboard install");
        }
        if (!(await askToInstall())) {
            log("Nothing was installed.");
            return 1;
        }
        await installApp();
        app = findInstalledApp();
        if (!app) throw new Error("The installer finished, but Paperboard isn't where it installs to. Nothing was opened.");
    }
    await openApp(app, args);
    log(args.includes("--web") ? "Opening Paperboard in your browser..." : "Opening Paperboard...");
    return 0;
}

async function serveCrane(args: string[]): Promise<number> {
    // the same registry override the desktop app honours outside
    // production; the release key still decides what runs
    const registry = process.env.ORIGAMI_REGISTRY_URL || DEFAULT_REGISTRY;
    const crane = await ensureCrane({ registry, minVersion: pkg.version, log });
    return runCrane(crane.binary, args);
}

async function main(): Promise<number> {
    const args = process.argv.slice(2);
    const [command] = args;
    if (command === undefined) return openPaperboard([]);
    if (args.length === 1 && (command === "web" || command === "--web")) return openPaperboard(["--web"]);
    if (args.length === 1 && command === "install") {
        await installApp();
        return 0;
    }
    if (args.length === 1 && (command === "help" || command === "--help" || command === "-h")) {
        process.stdout.write(HELP);
        return 0;
    }
    return serveCrane(args);
}

main().then(
    (code) => process.exit(code),
    (err) => {
        process.stderr.write(`paperboard: ${(err as Error)?.message || String(err)}\n`);
        process.exit(1);
    },
);
