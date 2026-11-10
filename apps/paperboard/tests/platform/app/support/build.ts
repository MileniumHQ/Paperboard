// The built artifacts the release smoke runs against, produced fresh into
// temp dirs by this test process: the electron-vite build of the desktop
// app, the crane compiled for the host target, and first-party panels built
// from the repo. Never whatever an earlier developer left in out/ or dist/.
import * as fs from "node:fs";
import * as path from "node:path";
import { BUN_TARGET_MAP, type Target } from "../../../../../../scripts/publishLib";
import { writeNodePtySidecar } from "../../../../../../scripts/craneSidecar";
import { tempDir } from "./temp";

export const APP_DIR = path.resolve(import.meta.dir, "../../../..");
export const REPO_DIR = path.resolve(APP_DIR, "../..");
export const APP_PACKAGE = JSON.parse(fs.readFileSync(path.join(APP_DIR, "package.json"), "utf8")) as {
    name: string;
    productName: string;
    version: string;
    main: string;
};

// generous: a cold CI runner builds everything inside one hook
export const BUILD_TIMEOUT_MS = 10 * 60_000;

export function hostTarget(): Target {
    const os = process.platform === "darwin" ? "macos" : process.platform === "win32" ? "windows" : process.platform === "linux" ? "linux" : null;
    const arch = process.arch === "x64" || process.arch === "arm64" ? process.arch : null;
    if (!os || !arch) throw new Error(`Paperboard does not ship for ${process.platform}-${process.arch}`);
    const target = `${os}-${arch}` as Target;
    if (!(target in BUN_TARGET_MAP)) throw new Error(`Paperboard does not ship for ${target}`);
    return target;
}

export async function run(cmd: string[], cwd: string, env: Record<string, string | undefined> = process.env): Promise<string> {
    const child = Bun.spawn(cmd, { cwd, env, stdout: "pipe", stderr: "pipe" });
    const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    if (code !== 0) throw new Error(`${cmd.join(" ")} (in ${cwd}) exited ${code}\n${out}\n${err}`);
    return out;
}

function once<T>(make: () => Promise<T>): () => Promise<T> {
    let pending: Promise<T> | null = null;
    return () => (pending ??= make());
}

export interface BuiltApp {
    // the directory Electron runs: package.json, out/, node_modules
    dir: string;
    version: string;
}

// electron-vite's production build, laid out like the packaged app: the
// app's package.json beside out/, and its dependencies reachable the way
// the asar's node_modules are
export const buildApp = once(async (): Promise<BuiltApp> => {
    const dir = tempDir("app");
    const viteBin = path.join(APP_DIR, "node_modules", "electron-vite", "bin", "electron-vite.js");
    await run([process.execPath, viteBin, "build", "--outDir", path.join(dir, "out"), "--logLevel", "error"], APP_DIR);
    const { name, productName, version, main } = APP_PACKAGE;
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name, productName, version, main }));
    // a junction needs no privilege on Windows; elsewhere it is a symlink
    fs.symlinkSync(path.join(APP_DIR, "node_modules"), path.join(dir, "node_modules"), "junction");
    for (const entry of ["out/main/index.js", "out/preload/index.js", "out/renderer/index.html"]) {
        if (!fs.existsSync(path.join(dir, entry))) throw new Error(`electron-vite build produced no ${entry}`);
    }
    return { dir, version };
});

export interface BuiltCrane {
    // the compiled binary, named as the release names it inside its archive
    file: string;
    version: string;
    target: Target;
}

// `bun build --compile` of papercrane/main.ts for the host target, as
// scripts/publish.ts compiles it. `version` stamps a different release
// number into the binary (the update entries need a newer release);
// `bootFailure` compiles a release whose daemon exits before it serves;
// `protocolVersion` one that speaks another wire protocol version.
//
// The stamps need bundler plugins, which only Bun.build takes, so it
// bundles and the CLI compiles the bundle. Bun.build's own `compile` makes a
// Windows executable whose entry never sees import.meta.main (the binary
// starts, runs nothing and exits 0), so the release's CLI compile is the one
// that makes the executable on every target.
export async function compileCrane(options: { version?: string; bootFailure?: boolean; protocolVersion?: number } = {}): Promise<BuiltCrane> {
    const target = hostTarget();
    const dir = tempDir("crane");
    const file = path.join(dir, target.startsWith("windows") ? `papercrane-${target}.exe` : `papercrane-${target}`);
    const version = options.version ?? APP_PACKAGE.version;
    const entry = options.bootFailure ? path.join(dir, "broken.ts") : path.join(APP_DIR, "papercrane", "main.ts");
    if (options.bootFailure) {
        fs.writeFileSync(entry, `console.error("this release cannot start");\nprocess.exit(70);\n`);
    }
    const pkgFilter = /[\\/]apps[\\/]paperboard[\\/]package\.json$/;
    const bundleDir = tempDir("crane-bundle");
    const result = await Bun.build({
        entrypoints: [entry],
        target: "bun",
        outdir: bundleDir,
        naming: "main.js",
        plugins: [{
            name: "release-version",
            setup(build) {
                build.onLoad({ filter: pkgFilter }, async (args) => {
                    const pkg = JSON.parse(await Bun.file(args.path).text());
                    pkg.version = version;
                    return { contents: `export default ${JSON.stringify(pkg)};`, loader: "js" };
                });
                if (options.protocolVersion !== undefined) {
                    const wanted = options.protocolVersion;
                    build.onLoad({ filter: /[\\/]papercrane[\\/]protocol\.ts$/ }, async (args) => {
                        const source = await Bun.file(args.path).text();
                        const pinned = /export const PROTOCOL_VERSION = \d+;/;
                        if (!pinned.test(source)) throw new Error("papercrane/protocol.ts no longer declares PROTOCOL_VERSION as a number");
                        return { contents: source.replace(pinned, `export const PROTOCOL_VERSION = ${wanted};`), loader: "ts" };
                    });
                }
            },
        }],
    });
    if (!result.success) throw new Error(`crane bundle failed:\n${result.logs.map(String).join("\n")}`);
    await run([process.execPath, "build", "--compile", `--target=${BUN_TARGET_MAP[target]}`, path.join(bundleDir, "main.js"), "--outfile", file], bundleDir);
    if (!fs.existsSync(file)) throw new Error(`crane compile produced no ${file}`);
    // every Windows crane ships the node-pty sidecar beside it
    if (target.startsWith("windows")) writeNodePtySidecar(dir, path.join(APP_DIR, "node_modules", "node-pty"));
    return { file, version, target };
}

export const buildCrane = once(() => compileCrane());

export const FIRST_PARTY_PANELS = [
    "dev.paperboard.agents",
    "dev.paperboard.botcreator",
    "dev.paperboard.gameserver",
    "dev.paperboard.terminal",
] as const;
export type FirstPartyPanel = (typeof FIRST_PARTY_PANELS)[number];

// A panel built the way its package.json builds it (vite for the frame,
// bun for dist/service.js), into a temp copy of the installable panel:
// manifest.json, branding/ and dist/.
const panelBuilds = new Map<string, Promise<string>>();
export function buildPanel(id: FirstPartyPanel): Promise<string> {
    let pending = panelBuilds.get(id);
    if (!pending) {
        pending = (async () => {
            const src = path.join(REPO_DIR, "panels", id);
            const out = path.join(tempDir("panel"), id);
            const dist = path.join(out, "dist");
            const viteBin = path.join(src, "node_modules", "vite", "bin", "vite.js");
            await run([process.execPath, viteBin, "build", "--outDir", dist, "--emptyOutDir", "--logLevel", "error"], src);
            await run([process.execPath, "build", ...serviceBuildArgs(src, dist)], src);
            fs.copyFileSync(path.join(src, "manifest.json"), path.join(out, "manifest.json"));
            fs.cpSync(path.join(src, "branding"), path.join(out, "branding"), { recursive: true });
            return out;
        })();
        panelBuilds.set(id, pending);
    }
    return pending;
}

// the panel's own `bun build` step from its package.json build script, with
// its ./dist outputs pointed at `dist`
function serviceBuildArgs(src: string, dist: string): string[] {
    const script: string = JSON.parse(fs.readFileSync(path.join(src, "package.json"), "utf8")).scripts.build;
    const step = script.split("&&").map((s) => s.trim()).find((s) => s.startsWith("bun build "));
    if (!step) throw new Error(`${src}: the build script has no bun build step: ${script}`);
    return step.split(/\s+/).slice(2).map((arg) => {
        const m = /^(--\w[\w-]*=)?\.\/dist(\/.*)?$/.exec(arg);
        return m ? `${m[1] ?? ""}${path.join(dist, ...(m[2] ?? "").split("/").filter(Boolean))}` : arg;
    });
}

// installs a built panel into a data dir the way the daemon lays one out
export async function installBuiltPanel(dataDir: string, id: FirstPartyPanel): Promise<void> {
    fs.cpSync(await buildPanel(id), path.join(dataDir, "panels", id), { recursive: true });
}
