// The proof that matters for a scaffolder: what it writes builds, passes its
// own tests and packs, for every choice. It runs the real toolchain (tsc, vite,
// bun) in a temporary folder whose node_modules links this repo's libraries
// and this package's devDependencies (the template's own dependency ranges,
// which scaffold.test.ts pins), so it needs neither network nor an install.
import { afterAll, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "fs";
import { tmpdir } from "os";
import { dirname, join, resolve } from "path";
import { packPanel } from "../../paperapi/src/pack";
import { parseStoreManifest } from "../../paperapi/src/storeListing";
import { scaffoldPanel, type PanelFeatures } from "../src/scaffold";

const PACKAGE_DIR = resolve(import.meta.dir, "..");
const PACKAGES = resolve(PACKAGE_DIR, "..");
const roots: string[] = [];

afterAll(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function link(from: string, to: string) {
    mkdirSync(dirname(to), { recursive: true });
    symlinkSync(from, to, "dir");
}

function run(cwd: string, cmd: string[]): { ok: boolean; output: string } {
    // the host's PAPERBOARD_DIR must not reach a panel's tests
    const proc = Bun.spawnSync(cmd, { cwd, env: { ...process.env, PAPERBOARD_DIR: join(cwd, ".paperboard-test") }, stdout: "pipe", stderr: "pipe" });
    return { ok: proc.exitCode === 0, output: `${proc.stdout}${proc.stderr}` };
}

function scaffoldAndLink(features: Partial<PanelFeatures>) {
    const root = mkdtempSync(join(tmpdir(), "create-panel-build-"));
    roots.push(root);
    const { targetDir } = scaffoldPanel({ mode: "standalone", id: "dev.example.proof", displayName: "Proof", features, parentDir: root });
    const modules = join(targetDir, "node_modules");
    const own = join(PACKAGE_DIR, "node_modules");
    for (const name of [".bin", "solid-js", "typescript", "vite", "vite-plugin-solid", "@types"]) link(join(own, name), join(modules, name));
    link(join(PACKAGES, "paperapi"), join(modules, "@mileniumhq/paperapi"));
    link(join(PACKAGES, "paperui"), join(modules, "@mileniumhq/paperui"));
    return targetDir;
}

describe("a scaffolded panel", () => {
    const cases: Array<[string, Partial<PanelFeatures>]> = [
        ["with everything", {}],
        ["with no widget", { widget: false }],
        ["with no service, widget or store", { service: false, widget: false, store: false }],
    ];

    for (const [name, features] of cases) {
        it(`${name} builds, passes its own tests and packs`, () => {
            const dir = scaffoldAndLink(features);
            const withService = features.service !== false;
            const withWidget = features.widget !== false && withService;

            const build = run(dir, ["bun", "run", "build"]);
            expect(build).toMatchObject({ ok: true });
            expect(existsSync(join(dir, "dist/index.html"))).toBe(true);
            expect(existsSync(join(dir, "dist/service.js"))).toBe(withService);
            expect(existsSync(join(dir, "dist/widget.html"))).toBe(withWidget);

            const tests = run(dir, ["bun", "test"]);
            expect(tests).toMatchObject({ ok: true });
            expect(tests.output).toContain("0 fail");

            // the packer holds the manifest to the rules the daemon and the registry apply
            const packed = packPanel({ targetDir: dir, outputDir: join(dir, "out"), autoBuild: false });
            expect(packed.id).toBe("dev.example.proof");
            expect(existsSync(packed.archivePath)).toBe(true);
            if (features.store !== false) {
                expect(parseStoreManifest(packed.manifest.store)).not.toBeNull();
                expect(readFileSync(join(dir, packed.manifest.store.about), "utf8")).toContain("# Proof");
            }
        }, 120_000);
    }

    it("fails its own UI standards guard when a component sets an inline style", () => {
        const dir = scaffoldAndLink({});
        const page = join(dir, "src/pages/CounterPage.tsx");
        Bun.write(page, readFileSync(page, "utf8").replace("<PaperPageHeader", '<PaperPageHeader style={{ color: "red" }}'));
        const tests = run(dir, ["bun", "test"]);
        expect(tests.ok).toBe(false);
        expect(tests.output).toContain("no component sets an inline style");
    }, 60_000);
});
