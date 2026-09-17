// install provenance (bun test): the library's trust wording is only honest
// if the provenance fact is recorded, survives upgrades, dies with
// uninstall, and distinguishes the reviewed registry from direct URLs.
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
    PaperCraneEngine,
    resolveInstallSource,
    REGISTRY_URL,
} from "../papercrane/engine";

let tmp: string;
let engine: PaperCraneEngine;

beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pb-provenance-"));
    engine = new PaperCraneEngine(tmp);
});

afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
});

function sourcesFile(): string {
    return path.join(tmp, "panels", ".install-sources.json");
}

describe("resolveInstallSource", () => {
    it("calls a registry-origin URL reviewed", () => {
        expect(resolveInstallSource(`${REGISTRY_URL}/panel/x/download`)).toBe("registry");
    });

    it("calls any other https origin direct", () => {
        expect(resolveInstallSource("https://example.com/panel.tar.gz")).toBe("direct");
    });

    it("treats an unparseable URL as direct, never registry", () => {
        expect(resolveInstallSource("not a url")).toBe("direct");
    });
});

describe("install source record", () => {
    it("records, updates, and forgets a panel's provenance", () => {
        (engine as any).recordInstallSource("panel.a", "registry");
        expect(JSON.parse(fs.readFileSync(sourcesFile(), "utf-8"))).toEqual({
            "panel.a": { source: "registry", at: expect.any(String) },
        });

        // reinstall from a different source overwrites the fact
        (engine as any).recordInstallSource("panel.a", "direct");
        expect(JSON.parse(fs.readFileSync(sourcesFile(), "utf-8"))["panel.a"].source).toBe("direct");

        (engine as any).forgetInstallSource("panel.a");
        expect(JSON.parse(fs.readFileSync(sourcesFile(), "utf-8"))).toEqual({});
    });

    it("forgetting an unrecorded panel writes nothing new", () => {
        (engine as any).forgetInstallSource("never.installed");
        expect(fs.existsSync(sourcesFile())).toBe(false);
    });

    it("a missing or corrupt record reads as empty, never throws", () => {
        expect((engine as any).readInstallSources()).toEqual({});
        fs.mkdirSync(path.join(tmp, "panels"), { recursive: true });
        fs.writeFileSync(sourcesFile(), "{not json");
        expect((engine as any).readInstallSources()).toEqual({});
    });

    it("listPanels attaches dev provenance to symlinked panels", async () => {
        const panelDir = path.join(tmp, "panels", "linked.panel");
        fs.mkdirSync(panelDir, { recursive: true });
        fs.writeFileSync(
            path.join(panelDir, "manifest.json"),
            JSON.stringify({ id: "dev.panel", name: "Linked" }),
        );
        fs.symlinkSync(panelDir, path.join(tmp, "panels", "dev.panel"));
        const panels = await engine.listPanels();
        // Only the link whose directory agrees with the manifest is valid.
        const dev = panels.find((p) => p.isLinked === true);
        expect(dev?.installSource).toBe("dev");
    });

    it("listPanels leaves provenance absent for panels with no record", async () => {
        const panelDir = path.join(tmp, "panels", "legacy.panel");
        fs.mkdirSync(panelDir, { recursive: true });
        fs.writeFileSync(
            path.join(panelDir, "manifest.json"),
            JSON.stringify({ id: "legacy.panel", name: "Legacy" }),
        );
        const panels = await engine.listPanels();
        const legacy = panels.find((p) => p.id === "legacy.panel");
        expect(legacy?.installSource).toBeUndefined();
    });
});
