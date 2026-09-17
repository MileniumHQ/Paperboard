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
    for (const name of ["paperapi", "paperui"]) {
        const dir = path.join(root, "packages", name);
        const [packed] = JSON.parse(run("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", tmp], dir));
        const manifest = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
        const files = new Set(packed.files.map((entry) => entry.path));
        const check = (value) => {
            if (typeof value === "string" && value.startsWith("./") && !files.has(value.slice(2))) throw new Error(`${manifest.name} exports a missing file: ${value}`);
            if (value && typeof value === "object") Object.values(value).forEach(check);
        };
        check(manifest.exports);
        dependencies[manifest.name] = `file:${path.join(tmp, packed.filename)}`;
    }
    fs.writeFileSync(path.join(tmp, "package.json"), JSON.stringify({ private: true, type: "module", dependencies, scripts: { build: "vite build" } }));
    fs.writeFileSync(path.join(tmp, "index.html"), '<div id="root"></div><script type="module" src="/main.tsx"></script>');
    fs.writeFileSync(path.join(tmp, "main.tsx"), `import { render } from "solid-js/web";
import { PaperProvider, PaperButton } from "@paperboard-dev/paperui";
import { config } from "@paperboard-dev/paperapi";
import "@paperboard-dev/paperui/style.css";
if (!config.get) throw new Error("SDK export missing");
render(() => <PaperProvider><PaperButton>Consumer</PaperButton></PaperProvider>, document.getElementById("root")!);`);
    fs.writeFileSync(path.join(tmp, "vite.config.mjs"), 'import solid from "vite-plugin-solid"; export default { plugins: [solid()] };');
    run("bun", ["install", "--ignore-scripts"]);
    run("node", ["--input-type=module", "-e", 'import { config } from "@paperboard-dev/paperapi"; if (typeof config.get !== "function") process.exit(1)']);
    run("node", ["-e", 'const { config } = require("@paperboard-dev/paperapi"); if (typeof config.get !== "function") process.exit(1)']);
    run("bun", ["run", "build"]);
    console.log("Package artifacts: exports exist; SDK ESM/CJS imports and packed Solid/Vite consumer build passed");
} catch (err) {
    console.error("Package consumer check failed:", err.message, err.stdout?.toString(), err.stderr?.toString());
    process.exitCode = 1;
} finally {
    fs.rmSync(tmp, { recursive: true, force: true });
}
