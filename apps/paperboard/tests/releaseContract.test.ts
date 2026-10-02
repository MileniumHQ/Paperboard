import { test, expect } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { packPanel } from "../../../packages/paperapi/src/pack";
import { isPanelId } from "../../../packages/paperapi/src/panelIdentity";
import worker from "../../origami/src/index";
import { PaperCraneEngine } from "../papercrane/engine";
import { releaseMessage } from "../papercrane/releaseSignature";
import { fixtureSign, FIXTURE_RELEASE_PUBLIC_KEY } from "./registryFixture";

test("all real first-party IDs follow the shared pack/publish/install identity contract", () => {
    for (const name of ["actions", "botcreator", "gameserver", "terminal"]) {
        const manifest = JSON.parse(fs.readFileSync(path.resolve(import.meta.dir, `../../../panels/dev.paperboard.${name}/manifest.json`), "utf8"));
        expect(isPanelId(manifest.id)).toBe(true);
    }
    for (const id of ["library", "settings", "landing", "Upper.Case", "a..b", "../x", "x".repeat(129)]) expect(isPanelId(id)).toBe(false);
});

test("real dotted identity survives pack, publish, metadata lookup, download and install", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "paperboard-release-"));
    const records = new Map<string, string>();
    const archives = new Map<string, Uint8Array>();
    const env: any = {
        AUTH_KEY: "fixture-publisher",
        PACKAGES: {
            get: async (key: string, options: any) => records.has(key) ? (options?.type === "json" ? JSON.parse(records.get(key)!) : records.get(key)) : null,
            put: async (key: string, value: string) => { records.set(key, value); },
            list: async ({ prefix = "" }: any) => ({ keys: [...records.keys()].filter((key) => key.startsWith(prefix)).map((name) => ({ name })), list_complete: true }),
        },
        PANELS_BUCKET: {
            put: async (key: string, bytes: Uint8Array) => { archives.set(key, bytes); },
            get: async (key: string) => archives.has(key) ? { body: archives.get(key), httpEtag: "fixture", writeHttpMetadata: () => undefined } : null,
        },
    };
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (request) => worker.fetch(request, env, {} as any) });
    env.PANEL_BASE_URL = `http://127.0.0.1:${server.port}`;
    try {
        const source = path.join(tmp, "source");
        fs.mkdirSync(path.join(source, "dist"), { recursive: true });
        const manifest = { id: "dev.test.release", name: "Release fixture", version: "0.1.0", base: "./dist/index.html" };
        fs.writeFileSync(path.join(source, "manifest.json"), JSON.stringify(manifest));
        fs.writeFileSync(path.join(source, "dist", "index.html"), "<html><title>Release fixture</title></html>");
        const packed = packPanel({ targetDir: source, outputDir: path.join(tmp, "archives"), autoBuild: false });
        const form = new FormData();
        // the publisher signs offline; origami stores the signature it is given
        const signature = fixtureSign(releaseMessage.panel(manifest.id, manifest.version, packed.sha256));
        form.set("metadata", JSON.stringify({ ...manifest, manifest, signature }));
        form.set("archive", new Blob([fs.readFileSync(packed.archivePath)]), packed.archiveName);
        const published = await fetch(`${env.PANEL_BASE_URL}/panel/publish`, { method: "POST", body: form, headers: { Authorization: "Bearer fixture-publisher" } });
        expect(published.status).toBe(200);
        const record = await (await fetch(`${env.PANEL_BASE_URL}/panel/${manifest.id}.json`)).json() as any;
        expect(record.id).toBe(manifest.id);
        expect(record.sha256).toBe(packed.sha256);
        // the daemon reads the same origami worker as its registry
        const engine = new PaperCraneEngine(path.join(tmp, "host"), undefined, env.PANEL_BASE_URL, FIXTURE_RELEASE_PUBLIC_KEY);
        expect((await engine.installPanel(manifest.id, { version: record.version, sha256: record.sha256 })).id).toBe(manifest.id);
        expect((await engine.listPanels()).map((p) => p.id)).toEqual([manifest.id]);
        expect(fs.readFileSync(engine.resolvePath("panels", manifest.id, "dist/index.html"), "utf8")).toContain("Release fixture");
    } finally {
        await server.stop(true);
        records.clear(); archives.clear();
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});
