import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as tar from "tar";
import { scaffoldPanel, type PanelFeatures } from "../src/scaffold";
import { startDaemon } from "./helpers/daemon";
import { linkDependencies, ok, paperapi, panelTestFolders, readJson, tempDir } from "./helpers/panel";

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
            const tmp = tempDir("tmp");
            await ok("bun", ["test"], v.dir, { PAPERBOARD_DIR: developer, TMPDIR: tmp });
            const seen = readFileSync(probeOut, "utf8");
            expect(seen).not.toBe(developer);
            expect(seen.startsWith(join(tmp, "panel-test-"))).toBe(true);
            // the throwaway folder goes when the panel's test run ends
            expect(existsSync(seen)).toBe(false);
            expect(panelTestFolders(tmp)).toEqual([]);
            expect(readdirSync(developer)).toEqual([]);
        } finally {
            rmSync(probe);
            rmSync(developer, { recursive: true, force: true });
            rmSync(probeDir, { recursive: true, force: true });
        }
    }, BUILD_TIMEOUT);
});

