#!/usr/bin/env bun
// Paperboard developer bootstrap. One command takes a fresh checkout to a
// running dev environment:
//
//   bun run setup          install, fetch Electron, build shared libs + panels, link
//   bun run build:panels   build shared libs + every panel
//   bun run link:panels    symlink panels/* into $PAPERBOARD_DIR/panels
//   bun run unlink:panels  remove the links created by link:panels
//
// Panels are reviewed, not sandboxed: linking the source tree is the normal
// dev loop, and the daemon refuses to overwrite a symlinked panel on install.
// Link targets and the trash-rename recovery live in paperapi/src/link.ts, so
// this script stays a thin driver and never re-implements that policy.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { linkAllPanels, unlinkPanel, listLinkedPanels } from "../packages/paperapi/src/link";
import { ensureElectron } from "./ensureElectron";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SHARED_PACKAGES = ["packages/paperapi", "packages/paperui"];
const APP_DIR = join(ROOT, "apps/paperboard");

function run(label: string, command: string, args: string[], cwd = ROOT): void {
    console.log(`\n=== ${label}`);
    const result = spawnSync(command, args, { cwd, stdio: "inherit" });
    if (result.error) throw result.error;
    if (result.status !== 0) {
        throw new Error(`${label} failed (exit ${result.status ?? "signal"})`);
    }
}

interface PanelDir {
    id: string;
    dir: string;
}

// A panel is a directory with a manifest and a package.json build script.
// Discovery reads the real tree; it never guesses an id from a name.
function discoverPanels(): PanelDir[] {
    const panelsRoot = join(ROOT, "panels");
    const panels: PanelDir[] = [];
    for (const entry of readdirSync(panelsRoot)) {
        const dir = join(panelsRoot, entry);
        if (!statSync(dir).isDirectory()) continue;
        const manifestPath = join(dir, "manifest.json");
        const pkgPath = join(dir, "package.json");
        if (!existsSync(manifestPath) || !existsSync(pkgPath)) continue;
        const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
        if (typeof manifest.id !== "string" || !manifest.id) {
            throw new Error(`panels/${entry}/manifest.json has no id`);
        }
        if (!pkg.scripts?.build) continue; // not a buildable panel; nothing to do
        panels.push({ id: manifest.id, dir });
    }
    return panels;
}

function install(): void {
    run("bun install", "bun", ["install"]);
}

function buildShared(): void {
    for (const pkg of SHARED_PACKAGES) run(`build ${pkg}`, "bun", ["run", "build"], join(ROOT, pkg));
}

function buildPanels(): void {
    for (const panel of discoverPanels()) {
        run(`build panels/${panel.id}`, "bun", ["run", "build"], panel.dir);
    }
}

// electron 44 dropped its postinstall, so `bun install` no longer downloads the
// runtime binary and `bun run dev` starts against a missing Electron. Fetch it
// here so setup leaves a runnable dev environment (see ensureElectron.ts).
function ensureAppElectron(): void {
    const require = createRequire(join(APP_DIR, "package.json"));
    const electronDir = dirname(require.resolve("electron/package.json"));
    const electronPkg = JSON.parse(readFileSync(join(electronDir, "package.json"), "utf8")) as { version: string };
    ensureElectron(electronDir, electronPkg.version);
}

function linkPanels(force: boolean): void {
    // linkAllPanels owns the linking policy (trash-rename recovery, skip
    // reporting); this driver only presents the result.
    const { linked, skipped } = linkAllPanels(join(ROOT, "panels"), { force });
    for (const entry of linked) console.log(`linked ${entry.id} -> ${entry.linkPath}`);
    for (const entry of skipped) console.error(`skipped ${entry.dir}: ${entry.reason}`);
    console.log(`\n${linked.length}/${linked.length + skipped.length} panels linked.`);
}

function unlinkPanels(): void {
    const active = listLinkedPanels();
    if (active.length === 0) {
        console.log("No dev links to remove.");
        return;
    }
    for (const link of active) {
        // listLinkedPanels only returns symlinks, so unlinkPanel cannot hit
        // its physical-directory refusal here.
        unlinkPanel(link.id);
        console.log(`unlinked ${link.id}`);
    }
}

function usage(): never {
    console.log(`Usage: bun scripts/dev.ts <command>

Commands:
  setup      install, fetch the Electron binary, build shared packages + panels, then link panels
  build      build shared packages + every panel
  libs       build shared packages only (what the app/CI builds consume)
  link       symlink every panel into $PAPERBOARD_DIR/panels
  unlink     remove the symlinks created by link
  status     list active dev links

Options:
  --force    with link/setup, replace an existing physical panel directory`);
    process.exit(0);
}

function main(): void {
    const [command, ...flags] = process.argv.slice(2);
    const force = flags.includes("--force");
    switch (command) {
        case undefined:
        case "help":
        case "--help":
        case "-h":
            usage();
            return;
        case "setup":
            install();
            ensureAppElectron();
            buildShared();
            buildPanels();
            linkPanels(force);
            return;
        case "build":
            buildShared();
            buildPanels();
            return;
        case "libs":
            buildShared();
            return;
        case "link":
            linkPanels(force);
            return;
        case "unlink":
            unlinkPanels();
            return;
        case "status": {
            const active = listLinkedPanels();
            if (active.length === 0) {
                console.log("No active panel dev links.");
                return;
            }
            for (const link of active) {
                console.log(`${link.isBroken ? "[BROKEN] " : ""}${link.id} -> ${link.targetPath}`);
            }
            return;
        }
        default:
            console.error(`dev: unknown command "${command}"`);
            process.exit(1);
    }
}

try {
    main();
} catch (err) {
    console.error(`dev: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
}
