// Real built AI service, authenticated SDK, daemon config and state hydration.
import { expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { once } from "node:events";
import { WebSocketServer } from "ws";
import { PaperCraneEngine } from "../papercrane/engine";
import { PaperCraneAuth } from "../papercrane/auth";
import { PanelServicesManager } from "../papercrane/panelServices";
import { setupWebSocketServer } from "../papercrane/ws";
import { CraneTransport } from "../../../packages/paperapi/src/ws";
import { PANEL_ID, UI_ACTION_IDS, type AiState, type Settings } from "../../../panels/dev.paperboard.agents/src/contract";

test("the agent's settings persist and hydrate through the running AI service", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-settings-wire-"));
    // the service looks for the chosen brain's command on PATH: only Codex is installed here, whatever this machine has
    const bin = path.join(root, "bin");
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, "codex"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    const originalPath = process.env.PATH;
    process.env.PATH = [bin, path.dirname(process.execPath)].join(path.delimiter);
    const manager = new PanelServicesManager(root);
    const engine = new PaperCraneEngine(root, manager);
    const auth = new PaperCraneAuth(false, path.join(root, "local"));
    const server = http.createServer();
    const wss = new WebSocketServer({ server });
    setupWebSocketServer(wss, engine, auth);
    let sdk: CraneTransport | undefined;
    try {
        const panelDir = path.join(root, "panels", PANEL_ID);
        fs.mkdirSync(panelDir, { recursive: true });
        const build = await Bun.build({
            entrypoints: [path.resolve(import.meta.dir, "../../../panels/dev.paperboard.agents/src/service.ts")],
            outdir: panelDir,
            target: "node",
            external: ["@mileniumhq/paperui"],
        });
        if (!build.success) throw new Error(`AI service build failed: ${build.logs.join("\n")}`);
        fs.writeFileSync(path.join(panelDir, "manifest.json"), JSON.stringify({ id: PANEL_ID, name: "AI", service: "service.js" }));
        server.listen(0, "127.0.0.1");
        await once(server, "listening");
        const port = (server.address() as { port: number }).port;
        manager.init(port, undefined, auth);
        await manager.waitUntilReady(PANEL_ID);
        sdk = new CraneTransport({ port, token: auth.issuePanelToken(PANEL_ID), computerId: "local" });
        const call = async <T>(name: string, arg?: unknown): Promise<T> =>
            (await sdk!.call<{ result: T }>("actions:call", { panelId: PANEL_ID, action: name, args: [arg] })).result;
        const state = () => call<AiState>("__getState");

        expect((await state()).settings).toBeNull();

        // what onboarding saves
        const settings: Settings = { name: "Pixel", harness: "codex", model: null, compaction: "summarize" };
        expect(await call(UI_ACTION_IDS.setup, { settings })).toEqual({ saved: true });
        expect((await state()).settings).toEqual(settings);
        expect(await engine.getConfig(PANEL_ID)).toEqual(settings);

        // a brain that isn't installed is refused loudly, and what was saved stays
        await expect(call(UI_ACTION_IDS.setup, { settings: { ...settings, harness: "claude-code", name: "Other" } })).rejects.toThrow();
        expect(await engine.getConfig(PANEL_ID)).toEqual(settings);

        // a restarted service reads them from the daemon's config
        await manager.stopService(PANEL_ID);
        manager.startService(PANEL_ID);
        await manager.waitUntilReady(PANEL_ID);
        expect((await state()).settings).toEqual(settings);
    } finally {
        process.env.PATH = originalPath;
        sdk?.close();
        await manager.stopService(PANEL_ID);
        await engine.disposeClients();
        for (const socket of wss.clients) socket.terminate();
        await new Promise<void>((resolve) => wss.close(() => resolve()));
        if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
        auth.dispose();
        fs.rmSync(root, { recursive: true, force: true });
    }
}, 30000);
