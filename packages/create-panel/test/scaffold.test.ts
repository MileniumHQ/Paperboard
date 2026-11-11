import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as tar from "tar";
import paperapiPackage from "../../paperapi/package.json";
import paperuiPackage from "../../paperui/package.json";
import { assertRelativePanelBuild } from "../../../scripts/publishManifest";
import { libraryDependencies, scaffoldPanel, type PanelFeatures } from "../src/scaffold";
import { startDaemon } from "./helpers/daemon";
import { linkDependencies, ok, paperapi, panelTestFolders, readJson, tempDir, writtenFiles } from "./helpers/panel";

const BUILD_TIMEOUT = 120_000;

interface Variant {
    name: string;
    id: string;
    features: PanelFeatures;
    dir: string;
}

const variants: Variant[] = [
    { name: "everything on", id: "dev.example.full", features: { service: true, widget: true, store: true }, dir: "" },
    { name: "no widget", id: "dev.example.nowidget", features: { service: true, widget: false, store: true }, dir: "" },
    { name: "no service, widget or store", id: "dev.example.bare", features: { service: false, widget: false, store: false }, dir: "" },
];

let parent: string;

beforeAll(async () => {
    parent = tempDir("variants");
    for (const v of variants) {
        v.dir = scaffoldPanel({ mode: "standalone", id: v.id, parentDir: parent, features: v.features }).targetDir;
        linkDependencies(v.dir);
        await ok("bun", ["run", "build"], v.dir);
    }
}, BUILD_TIMEOUT);

afterAll(() => {
    rmSync(parent, { recursive: true, force: true });
});

// Every feature choice builds, tests, links and packs.
describe("every feature choice builds, tests, links and packs", () => {
    test("no feature marker or template token survives in any written file", () => {
        for (const v of variants) {
            for (const file of writtenFiles(v.dir)) {
                const content = readFileSync(join(v.dir, file), "utf8");
                expect({ file, markers: /@(if|endif)\b/.test(content), tokens: content.match(/__PANEL_[A-Z]+__|__PAPER[A-Z]+_DEP__/g) }).toEqual({ file, markers: false, tokens: null });
            }
        }
    });

    test("the build emits the service and widget bundles only when chosen", () => {
        for (const v of variants) {
            const dist = readdirSync(join(v.dir, "dist"));
            expect({ variant: v.name, page: dist.includes("index.html"), service: dist.includes("service.js"), widget: dist.includes("widget.html") }).toEqual({
                variant: v.name,
                page: true,
                service: v.features.service,
                widget: v.features.widget,
            });
            const manifest = readJson(join(v.dir, "manifest.json"));
            expect({ service: "service" in manifest, widgets: "widgets" in manifest, store: "store" in manifest }).toEqual({
                service: v.features.service,
                widgets: v.features.widget,
                store: v.features.store,
            });
            expect(existsSync(join(v.dir, "store"))).toBe(v.features.store);
        }
    });

    // a browser serves the panel from a folder of the shell's origin
    test("the build links its files by relative address", () => {
        for (const v of variants) expect(() => assertRelativePanelBuild(v.dir, v.id)).not.toThrow();
    });

    test("each variant passes its own tests and leaves no data folder behind", async () => {
        const before = panelTestFolders();
        for (const v of variants) {
            const result = await ok("bun", ["test"], v.dir);
            expect(`${result.stdout}${result.stderr}`).toMatch(/\b0 fail\b/);
        }
        expect([...panelTestFolders()].filter((name) => !before.has(name))).toEqual([]);
    }, BUILD_TIMEOUT);

    test("each variant links with paperapi link and passes doctor against a running Paperboard", async () => {
        const dataDir = process.env.PAPERBOARD_DIR!;
        for (const v of variants) {
            const linked = await paperapi(["link"], v.dir, { PAPERBOARD_DIR: dataDir });
            expect(linked.code).toBe(0);
        }
        const daemon = await startDaemon();
        try {
            for (const v of variants.filter((x) => x.features.service)) await daemon.serviceRegistered(v.id);
            for (const v of variants) {
                const doctor = await paperapi(["doctor", "--json"], v.dir, { PAPERBOARD_DIR: dataDir });
                const report = JSON.parse(doctor.stdout);
                expect({ variant: v.name, code: doctor.code, problems: report.problems, warnings: report.warnings }).toEqual({ variant: v.name, code: 0, problems: 0, warnings: 0 });
                const names = report.checks.map((c: { name: string; status: string }) => `${c.name}:${c.status}`);
                expect(names).toEqual(["Manifest:ok", "Build:ok", "Link:ok", "Paperboard:ok", ...(v.features.service ? ["Service:ok"] : [])]);
            }
        } finally {
            await daemon.stop();
        }
    }, BUILD_TIMEOUT);

    test("each variant packs into <id>-<version>.tar.gz with its manifest and dist", async () => {
        for (const v of variants) {
            const packed = await paperapi(["pack", "--json"], v.dir);
            expect(packed.code).toBe(0);
            const result = JSON.parse(packed.stdout);
            expect(result.archiveName).toBe(`${v.id}-0.1.0.tar.gz`);
            const entries: string[] = [];
            await tar.t({ file: result.archivePath, onReadEntry: (entry) => entries.push(entry.path) });
            expect(entries).toContain("manifest.json");
            expect(entries).toContain("dist/index.html");
            expect(entries.includes("dist/service.js")).toBe(v.features.service);
            expect(entries.includes("dist/widget.html")).toBe(v.features.widget);
            expect(entries.some((e) => e.startsWith("store/") || e.startsWith("src/") || e.startsWith("node_modules/"))).toBe(false);
        }
    }, BUILD_TIMEOUT);
});

// A panel's tests never touch the developer's Paperboard.
describe("a panel's tests never touch the developer's Paperboard", () => {
    test("the generated preload gives the panel's tests a throwaway PAPERBOARD_DIR even when the developer set one", async () => {
        const v = variants[0];
        const developer = tempDir("developer-data");
        const probeDir = tempDir("probe");
        const probeOut = join(probeDir, "seen.txt");
        const probe = join(v.dir, "test", "zz-probe.test.ts");
        writeFileSync(
            probe,
            `import { test } from "bun:test";\nimport { writeFileSync } from "node:fs";\ntest("probe", () => { writeFileSync(${JSON.stringify(probeOut)}, process.env.PAPERBOARD_DIR ?? ""); });\n`,
        );
        try {
            const before = panelTestFolders();
            await ok("bun", ["test"], v.dir, { PAPERBOARD_DIR: developer });
            const seen = readFileSync(probeOut, "utf8");
            expect(seen).not.toBe(developer);
            expect(seen.startsWith(join(tmpdir(), "panel-test-"))).toBe(true);
            // the throwaway folder goes when the panel's test run ends
            expect(existsSync(seen)).toBe(false);
            expect([...panelTestFolders()].filter((name) => !before.has(name))).toEqual([]);
            expect(readdirSync(developer)).toEqual([]);
        } finally {
            rmSync(probe);
            rmSync(developer, { recursive: true, force: true });
            rmSync(probeDir, { recursive: true, force: true });
        }
    }, BUILD_TIMEOUT);
});

// Refusals write nothing.
describe("refusals write nothing", () => {
    test("a widget without a service, a first-party publisher and a rejected id throw and create no folder", () => {
        const dir = tempDir("refusals");
        try {
            expect(() => scaffoldPanel({ mode: "standalone", id: "dev.example.widget", parentDir: dir, features: { service: false, widget: true } })).toThrow(
                "a widget mirrors the service's state, so it needs a service",
            );
            expect(() => scaffoldPanel({ mode: "workspace", id: "dev.example.publisher", parentDir: dir, publisher: "Someone" })).toThrow(
                "panels in the Paperboard repo are published by Paperboard",
            );
            for (const id of ["settings", "Dev.Example.Upper", "../escape", ""]) {
                expect(() => scaffoldPanel({ mode: "standalone", id, parentDir: dir })).toThrow("Invalid panel id");
            }
            expect(readdirSync(dir)).toEqual([]);
            expect(existsSync(join(dir, "..", "escape"))).toBe(false);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test("an existing target directory is refused and left untouched", () => {
        const dir = tempDir("existing");
        try {
            const target = join(dir, "dev.example.taken");
            mkdirSync(target);
            writeFileSync(join(target, "keep.txt"), "mine");
            expect(() => scaffoldPanel({ mode: "standalone", id: "dev.example.taken", parentDir: dir })).toThrow("already exists");
            expect(readdirSync(target)).toEqual(["keep.txt"]);
            expect(readFileSync(join(target, "keep.txt"), "utf8")).toBe("mine");
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test("a scaffold that fails part-way removes the folder it started", () => {
        const dir = tempDir("partial");
        const template = tempDir("broken-template");
        try {
            writeFileSync(join(template, "manifest.json"), '{ "id": "__PANEL_ID__" }\n');
            writeFileSync(join(template, "broken.ts"), "// @if service\nexport {};\n");
            expect(() => scaffoldPanel({ mode: "standalone", id: "dev.example.partial", parentDir: dir, templateDir: template })).toThrow("@if service is never closed");
            expect(readdirSync(dir)).toEqual([]);
        } finally {
            rmSync(dir, { recursive: true, force: true });
            rmSync(template, { recursive: true, force: true });
        }
    });
});

// Standalone panels depend on the published SDK.
describe("standalone panels depend on the published SDK", () => {
    test("a standalone panel depends on ^<current version>, a workspace panel on workspace:*", () => {
        expect(libraryDependencies("standalone")).toEqual({ paperapi: `^${paperapiPackage.version}`, paperui: `^${paperuiPackage.version}` });
        expect(libraryDependencies("workspace")).toEqual({ paperapi: "workspace:*", paperui: "workspace:*" });
        const dir = tempDir("deps");
        try {
            const standalone = scaffoldPanel({ mode: "standalone", id: "dev.example.standalone", parentDir: dir });
            expect(readJson(join(standalone.targetDir, "package.json")).dependencies).toMatchObject({
                "@mileniumhq/paperapi": `^${paperapiPackage.version}`,
                "@mileniumhq/paperui": `^${paperuiPackage.version}`,
            });
            const workspace = scaffoldPanel({ mode: "workspace", id: "dev.example.workspace", parentDir: dir });
            expect(readJson(join(workspace.targetDir, "package.json")).dependencies).toMatchObject({
                "@mileniumhq/paperapi": "workspace:*",
                "@mileniumhq/paperui": "workspace:*",
            });
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

});

