// Consumer test: real packed archives, outside the workspace, with normal
// Node and Solid/Vite resolution. Build the libraries before running this.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "paperboard-package-consumer-"));
function run(command, args, cwd = tmp) {
    return execFileSync(command, args, { cwd, encoding: "utf8", timeout: 120_000, maxBuffer: 8 * 1024 * 1024,
        env: { ...process.env, PAPERBOARD_DIR: path.join(tmp, "data"), BUN_INSTALL_CACHE_DIR: path.join(tmp, "cache") } });
}
try {
    const dependencies = { "solid-js": "1.9.13", vite: "7.3.1", "vite-plugin-solid": "2.11.14" };
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
        dependencies[manifest.name] = `file:${tarball}`;
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
    run("bun", ["install", "--ignore-scripts"]);
    run("node", ["--input-type=module", "-e", 'import { config } from "@mileniumhq/paperapi"; if (typeof config.get !== "function") process.exit(1)']);
    run("node", ["-e", 'const { config } = require("@mileniumhq/paperapi"); if (typeof config.get !== "function") process.exit(1)']);
    run("bun", ["run", "build"]);

    // npm create @mileniumhq/panel runs the packed bin under Node in the
    // user's directory; the scaffolded panel must install, test, build and
    // link on its own. Its ^x.y.z library ranges point at the packed
    // tarballs here, since this check must not depend on the npm registry.
    const projects = path.join(tmp, "projects");
    fs.mkdirSync(projects);
    run("node", [path.join(tmp, "node_modules", "@mileniumhq", "create-panel", "dist", "cli.js"), "dev.paperboard.my-panel", "My Panel"], projects);
    const panel = path.join(projects, "dev.paperboard.my-panel");
    const panelPkg = JSON.parse(fs.readFileSync(path.join(panel, "package.json"), "utf8"));
    for (const name of ["@mileniumhq/paperapi", "@mileniumhq/paperui"]) {
        if (!/^\^\d/.test(panelPkg.dependencies[name])) throw new Error(`scaffolded ${name} is not a published range: ${panelPkg.dependencies[name]}`);
        panelPkg.dependencies[name] = `file:${tarballs[name]}`;
    }
    fs.writeFileSync(path.join(panel, "package.json"), JSON.stringify(panelPkg, null, 4));
    run("bun", ["install"], panel);
    run("bun", ["test"], panel);
    run("bun", ["run", "build"], panel);
    for (const built of ["dist/index.html", "dist/service.js"]) {
        if (!fs.existsSync(path.join(panel, built))) throw new Error(`scaffolded panel build is missing ${built}`);
    }
    run("node", [path.join(panel, "node_modules", ".bin", "paperapi"), "link"], panel);
    const linked = path.join(tmp, "data", "panels", "dev.paperboard.my-panel");
    if (fs.realpathSync(linked) !== fs.realpathSync(panel)) throw new Error(`paperapi link did not link the scaffolded panel at ${linked}`);
    console.log("Package artifacts: exports exist; SDK ESM/CJS imports, packed Solid/Vite consumer build, and packed create-panel scaffold/install/test/build/link passed");
} catch (err) {
    console.error("Package consumer check failed:", err.message, err.stdout?.toString(), err.stderr?.toString());
    process.exitCode = 1;
} finally {
    fs.rmSync(tmp, { recursive: true, force: true });
}
