// Consumer test: real packed archives, outside the workspace, with normal
// Node and Solid/Vite resolution. Build the libraries before running this.
// Runs under Bun (for Bun.semver and Bun.JSONC); the consumers run under Node.
//
// No network: every install is `bun install --offline --frozen-lockfile`
// against a lockfile written here from the workspace's bun.lock, and a
// throwaway package cache seeded from Bun's own cache, which the workspace's
// `bun install` fills. A dependency the workspace does not lock fails loudly.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "paperboard-package-consumer-"));
const cache = path.join(tmp, "cache");
function run(command, args, cwd = tmp) {
    return execFileSync(command, args, { cwd, encoding: "utf8", timeout: 120_000, maxBuffer: 8 * 1024 * 1024,
        env: { ...process.env, PAPERBOARD_DIR: path.join(tmp, "data"), BUN_INSTALL_CACHE_DIR: cache } });
}

const workspaceLock = Bun.JSONC.parse(fs.readFileSync(path.join(root, "bun.lock"), "utf8"));
// The workspace's patches are left out on purpose: a consumer installs the
// published, unpatched packages. Overrides or catalogs would change resolution
// in ways that copying entries does not carry, so they stop the check.
const unknownLockFields = Object.keys(workspaceLock)
    .filter((field) => !["lockfileVersion", "configVersion", "workspaces", "packages", "patchedDependencies"].includes(field));
const bunCache = execFileSync("bun", ["pm", "cache"], { encoding: "utf8" }).trim();
const lockMeta = (entry) => entry.find((part) => part && typeof part === "object" && !Array.isArray(part)) ?? {};
const lockVersion = (key) => workspaceLock.packages[key][0].slice(workspaceLock.packages[key][0].lastIndexOf("@") + 1);
// Bun's lookup: a dependency of the package at key a/b is a/b/x, then a/x, then x
function lockResolve(from, name) {
    for (let parent = from; ; parent = parent.includes("/") ? parent.slice(0, parent.lastIndexOf("/")) : "") {
        const key = parent ? `${parent}/${name}` : name;
        if (workspaceLock.packages[key]) return key;
        if (!parent) return null;
    }
}

// The throwaway cache links to every package in Bun's cache, so the installs
// below read it but write only into the throwaway one. Scope folders are made
// here, since a packed @mileniumhq tarball is extracted into its scope's.
function seedCache() {
    fs.mkdirSync(cache);
    for (const entry of fs.readdirSync(bunCache, { withFileTypes: true })) {
        // manifests and Bun's own working folders (@t@) are not packages
        if (!entry.isDirectory() || /^@.*@/.test(entry.name)) continue;
        if (!entry.name.startsWith("@")) { fs.symlinkSync(path.join(bunCache, entry.name), path.join(cache, entry.name)); continue; }
        fs.mkdirSync(path.join(cache, entry.name));
        for (const child of fs.readdirSync(path.join(bunCache, entry.name))) {
            fs.symlinkSync(path.join(bunCache, entry.name, child), path.join(cache, entry.name, child));
        }
    }
}

// Install `dir`'s package.json offline. Registry dependencies resolve to the
// versions the workspace locks; `file:` tarballs are locked by their hash.
function installOffline(dir, extraArgs = []) {
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    const packages = {};
    const queue = [];
    const workspace = manifest.name ? { name: manifest.name } : {};
    const requireTop = (name, range, from) => {
        const key = lockResolve("", name);
        if (!key || !Bun.semver.satisfies(lockVersion(key), range)) {
            throw new Error(`${from} needs ${name}@${range}, which the workspace's bun.lock does not lock at the top level`);
        }
        queue.push(key);
    };
    for (const section of ["dependencies", "devDependencies"]) {
        if (!manifest[section]) continue;
        workspace[section] = manifest[section];
        for (const [name, spec] of Object.entries(manifest[section])) {
            if (!spec.startsWith("file:")) { requireTop(name, spec, manifest.name ?? "the consumer"); continue; }
            const tarball = path.resolve(dir, spec.slice("file:".length));
            const packed = JSON.parse(execFileSync("tar", ["-xOzf", tarball, "package/package.json"], { encoding: "utf8" }));
            const meta = {};
            for (const field of ["dependencies", "optionalDependencies", "peerDependencies", "bin"]) {
                if (packed[field] && Object.keys(packed[field]).length > 0) meta[field] = packed[field];
            }
            const integrity = `sha512-${crypto.createHash("sha512").update(fs.readFileSync(tarball)).digest("base64")}`;
            packages[name] = [`${name}@${spec.slice("file:".length)}`, meta, integrity];
            for (const [dep, range] of Object.entries(packed.dependencies ?? {})) requireTop(dep, range, name);
        }
    }
    while (queue.length > 0) {
        const key = queue.shift();
        if (packages[key]) continue;
        const entry = workspaceLock.packages[key];
        packages[key] = entry;
        const meta = lockMeta(entry);
        for (const [name] of Object.entries(meta.dependencies ?? {})) {
            const dep = lockResolve(key, name);
            if (!dep) throw new Error(`bun.lock entry ${key} depends on ${name}, which bun.lock does not resolve`);
            queue.push(dep);
        }
        // optional and peer dependencies are locked only where something installs them
        for (const name of [...Object.keys(meta.optionalDependencies ?? {}), ...Object.keys(meta.peerDependencies ?? {})]) {
            const dep = lockResolve(key, name);
            if (dep) queue.push(dep);
        }
    }
    const lock = { lockfileVersion: workspaceLock.lockfileVersion, configVersion: workspaceLock.configVersion, workspaces: { "": workspace }, packages };
    fs.writeFileSync(path.join(dir, "bun.lock"), JSON.stringify(lock, null, 2));
    run("bun", ["install", "--offline", "--frozen-lockfile", ...extraArgs], dir);
}

try {
    if (unknownLockFields.length > 0) throw new Error(`bun.lock has fields this check does not copy: ${unknownLockFields.join(", ")}`);
    seedCache();
    // the versions the workspace's own panels build with, so bun.lock has them
    const dependencies = { "solid-js": "^1.9.17", vite: "^8.3.2", "vite-plugin-solid": "^2.11.14" };
    const tarballs = {};
    for (const name of ["paperapi", "paperui", "create-panel"]) {
        const dir = path.join(root, "packages", name);
        // bun pm pack prints "packed <size> <path>" per file and the tarball
        // path on its own line, so one pack yields both the file list and the
        // archive name. npm is not required on the machine running the gate.
        const output = run("bun", ["pm", "pack", "--ignore-scripts", "--destination", tmp], dir);
        const files = new Set();
        let tarball = null;
        for (const line of output.split("\n")) {
            const packed = line.match(/^packed \S+ (.+)$/);
            if (packed) { files.add(packed[1]); continue; }
            if (line.startsWith(tmp + path.sep) && line.endsWith(".tgz")) tarball = line.trim();
        }
        if (!tarball) throw new Error(`bun pm pack did not report a tarball for ${name}`);
        if (files.size === 0) throw new Error(`bun pm pack reported no files for ${name}`);
        const manifest = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
        const check = (value) => {
            if (typeof value === "string" && value.startsWith("./") && !files.has(value.slice(2))) throw new Error(`${manifest.name} exports a missing file: ${value}`);
            if (value && typeof value === "object") Object.values(value).forEach(check);
        };
        check(manifest.exports);
        for (const bin of Object.values(manifest.bin ?? {})) check(bin);
        tarballs[manifest.name] = tarball;
        dependencies[manifest.name] = `file:./${path.basename(tarball)}`;
    }
    fs.writeFileSync(path.join(tmp, "package.json"), JSON.stringify({ private: true, type: "module", dependencies, scripts: { build: "vite build" } }));
    fs.writeFileSync(path.join(tmp, "index.html"), '<div id="root"></div><script type="module" src="/main.tsx"></script>');
    fs.writeFileSync(path.join(tmp, "main.tsx"), `import { render } from "solid-js/web";
import { PaperProvider, PaperButton } from "@mileniumhq/paperui";
import { config } from "@mileniumhq/paperapi";
import "@mileniumhq/paperui/style.css";
if (!config.get) throw new Error("SDK export missing");
render(() => <PaperProvider><PaperButton>Consumer</PaperButton></PaperProvider>, document.getElementById("root")!);`);
    fs.writeFileSync(path.join(tmp, "vite.config.mjs"), 'import solid from "vite-plugin-solid"; export default { plugins: [solid()] };');
    installOffline(tmp, ["--ignore-scripts"]);
    run("node", ["--input-type=module", "-e", 'import { config } from "@mileniumhq/paperapi"; if (typeof config.get !== "function") process.exit(1)']);
    run("node", ["-e", 'const { config } = require("@mileniumhq/paperapi"); if (typeof config.get !== "function") process.exit(1)']);
    run("bun", ["run", "build"]);

    // npm create @mileniumhq/panel runs the packed bin under Node in the
    // user's directory; the scaffolded panel must install, test, build and
    // link on its own. Its ^x.y.z library ranges point at the packed
    // tarballs here, and the rest of its dependencies install offline.
    const projects = path.join(tmp, "projects");
    fs.mkdirSync(projects);
    run("node", [path.join(tmp, "node_modules", "@mileniumhq", "create-panel", "dist", "cli.js"), "dev.paperboard.my-panel", "My Panel"], projects);
    const panel = path.join(projects, "dev.paperboard.my-panel");
    const panelPkg = JSON.parse(fs.readFileSync(path.join(panel, "package.json"), "utf8"));
    for (const name of ["@mileniumhq/paperapi", "@mileniumhq/paperui"]) {
        if (!/^\^\d/.test(panelPkg.dependencies[name])) throw new Error(`scaffolded ${name} is not a published range: ${panelPkg.dependencies[name]}`);
        panelPkg.dependencies[name] = `file:${path.relative(panel, tarballs[name])}`;
    }
    fs.writeFileSync(path.join(panel, "package.json"), JSON.stringify(panelPkg, null, 4));
    installOffline(panel);
    run("bun", ["test"], panel);
    run("bun", ["run", "build"], panel);
    for (const built of ["dist/index.html", "dist/service.js"]) {
        if (!fs.existsSync(path.join(panel, built))) throw new Error(`scaffolded panel build is missing ${built}`);
    }
    run("node", [path.join(panel, "node_modules", ".bin", "paperapi"), "link"], panel);
    const linked = path.join(tmp, "data", "panels", "dev.paperboard.my-panel");
    if (fs.realpathSync(linked) !== fs.realpathSync(panel)) throw new Error(`paperapi link did not link the scaffolded panel at ${linked}`);
    // doctor holds the build and the link to what Paperboard looks for; no
    // Paperboard runs here, so that is the one problem it may report
    const doctor = spawnSync("node", [path.join(panel, "node_modules", ".bin", "paperapi"), "doctor", "--json"], {
        cwd: panel, encoding: "utf8", timeout: 60_000, env: { ...process.env, PAPERBOARD_DIR: path.join(tmp, "data") },
    });
    const report = JSON.parse(doctor.stdout);
    const failing = report.checks.filter((check) => check.status !== "ok" && check.name !== "Paperboard" && check.name !== "Service");
    if (doctor.status !== 1 || failing.length > 0 || report.problems !== 1) {
        throw new Error(`paperapi doctor found problems in the scaffolded panel (exit ${doctor.status}): ${JSON.stringify(report.checks)}`);
    }
    console.log("Package artifacts: exports exist; SDK ESM/CJS imports, packed Solid/Vite consumer build, and packed create-panel scaffold/install/test/build/link/doctor passed");
} catch (err) {
    console.error("Package consumer check failed:", err.message, err.stdout?.toString(), err.stderr?.toString());
    process.exitCode = 1;
} finally {
    fs.rmSync(tmp, { recursive: true, force: true });
}
