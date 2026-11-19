// Builds a development fixture panel under dev/ and installs it into a
// Paperboard data dir. Fixtures are not under panels/, so nothing publishes
// them. Shared by the install-*-demo scripts.
//
// --dir (or PAPERBOARD_DIR) is required: this never guesses your real
// install. The daemon starts panel services when it starts, so restart
// Paperboard (or "Restart panel" from the panel's menu) after installing.
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";

export interface DevPanel {
    /** the fixture's folder, holding manifest.json, its html pages and src/ */
    source: string;
    /** src/ entries bundled for the browser, one per page */
    pages: string[];
    /** src/ entry bundled for node, the panel's service */
    service: string;
    /** html files copied into dist/ */
    html: string[];
}

export const WIDGET_DEMO: DevPanel = {
    source: resolve(import.meta.dir, "../dev/widget-demo"),
    pages: ["panel.ts", "widgets.ts"],
    service: "service.ts",
    html: ["index.html", "widget.html"],
};

export const API_DEMO: DevPanel = {
    source: resolve(import.meta.dir, "../dev/api-demo"),
    pages: ["panel.ts"],
    service: "service.ts",
    html: ["index.html"],
};

/** the install-*-demo scripts: `--dir <data dir>` installs or replaces, `--remove` removes */
export async function installDevPanel(panel: DevPanel): Promise<void> {
    const manifest = JSON.parse(readFileSync(join(panel.source, "manifest.json"), "utf8")) as { id: string };
    const { values } = parseArgs({
        options: { dir: { type: "string" }, remove: { type: "boolean", default: false } },
    });
    const dataDir = values.dir ?? process.env.PAPERBOARD_DIR;
    if (!dataDir) {
        console.error("Pass --dir <paperboard data dir> (or set PAPERBOARD_DIR). This script never guesses your real install.");
        process.exit(2);
    }
    const target = join(resolve(dataDir), "panels", manifest.id);
    if (existsSync(target) && lstatSync(target).isSymbolicLink()) {
        console.error(`${target} is a symlink (a linked dev panel); refusing to replace it.`);
        process.exit(1);
    }
    if (values.remove) {
        rmSync(target, { recursive: true, force: true });
        console.log(`Removed ${target}`);
        process.exit(0);
    }
    try {
        await installDevPanelInto(panel, dataDir);
    } catch (err) {
        console.error(err instanceof Error ? err.message : err);
        process.exit(1);
    }
    console.log(`Installed ${manifest.id} into ${target}`);
}

/** builds `panel` and installs it into `dataDir` the way an install leaves a panel; throws why it couldn't */
export async function installDevPanelInto(panel: DevPanel, dataDir: string): Promise<void> {
    const manifest = JSON.parse(readFileSync(join(panel.source, "manifest.json"), "utf8")) as { id: string };
    const target = join(resolve(dataDir), "panels", manifest.id);
    if (existsSync(target) && lstatSync(target).isSymbolicLink()) {
        throw new Error(`${target} is a symlink (a linked dev panel); refusing to replace it.`);
    }

    // a fresh build directory: a failed build leaves the installed copy alone
    const staging = `${target}.installing`;
    rmSync(staging, { recursive: true, force: true });
    mkdirSync(join(staging, "dist"), { recursive: true });

    // build against the SDK's packed dist, the artifact real panels bundle;
    // rebuild it first when this checkout's source is newer. A dist the gate
    // names in PAPERBOARD_GATE_PREBUILT was restored by CI from a cache of
    // these exact sources (scripts/gate/gate.sh): it is current, though its files
    // are older than the checkout's
    const SDK = resolve(import.meta.dir, "../../../packages/paperapi");
    const sdkDist = join(SDK, "dist/paperapi.es.js");
    const prebuilt = ` ${process.env.PAPERBOARD_GATE_PREBUILT ?? ""} `.includes(" paperapi ");
    const newestSource = Math.max(...readdirSync(join(SDK, "src"), { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => statSync(join(entry.parentPath, entry.name)).mtimeMs));
    if (!existsSync(sdkDist) || (!prebuilt && statSync(sdkDist).mtimeMs < newestSource)) {
        console.log("Rebuilding @mileniumhq/paperapi (its source is newer than its dist)...");
        const built = spawnSync("bun", ["run", "build"], { cwd: SDK, stdio: "inherit" });
        if (built.status !== 0) {
            rmSync(staging, { recursive: true, force: true });
            throw new Error(`Rebuilding @mileniumhq/paperapi failed (exit ${built.status})`);
        }
    }
    // one build per page: each page gets its own stylesheet next to its script
    const build = (entry: string, target: "browser" | "node") =>
        Bun.build({
            entrypoints: [join(panel.source, "src", entry)],
            outdir: join(staging, "dist"),
            target,
            format: "esm",
            minify: true,
            // the SDK's Node-only paths import node:* lazily; a browser page
            // never runs them, so they stay out of the bundle as panels' vite builds do
            external: target === "browser" ? ["node:*"] : [],
            naming: { entry: "[name].[ext]", asset: "[name]-[hash].[ext]" },
        });
    const results = [...(await Promise.all(panel.pages.map((page) => build(page, "browser")))), await build(panel.service, "node")];
    const failed = results.filter((result) => !result.success);
    if (failed.length) {
        rmSync(staging, { recursive: true, force: true });
        throw new Error(`Building ${manifest.id} failed:\n${failed.flatMap((result) => result.logs.map(String)).join("\n")}`);
    }

    for (const html of panel.html) copyFileSync(join(panel.source, html), join(staging, "dist", html));
    writeFileSync(join(staging, "manifest.json"), readFileSync(join(panel.source, "manifest.json")));

    rmSync(target, { recursive: true, force: true });
    mkdirSync(dirname(target), { recursive: true });
    // the old copy goes only once the new one built
    renameSync(staging, target);
}
