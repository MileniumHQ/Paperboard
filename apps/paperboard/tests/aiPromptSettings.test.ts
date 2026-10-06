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
import { saveSettings } from "../../../panels/dev.paperboard.ai/src/core/saveSettings";
import { PANEL_ID, UI_ACTION_IDS } from "../../../panels/dev.paperboard.ai/src/contract";
import type { AiState, Settings } from "../../../panels/dev.paperboard.ai/src/core/types";

test("custom prompt toggle persists and hydrates through the running AI service", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-prompt-wire-"));
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
            entrypoints: [path.resolve(import.meta.dir, "../../../panels/dev.paperboard.ai/src/service.ts")],
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
        const action = async <T>(name: string, patch?: Partial<Settings>): Promise<T> =>
            (await sdk!.call<{ result: T }>("actions:call", { panelId: PANEL_ID, action: name, args: [patch] })).result;
        let displayed: AiState | undefined;
        const save = (patch: Partial<Settings>) => saveSettings(patch, {
            update: (patch) => action<Settings>(UI_ACTION_IDS.updateSettings, patch),
            refresh: async () => { displayed = await action<AiState>("__getState"); },
        });
        // No state-event subscription: the settings UI must refresh after saving.
        await save({ customPromptEnabled: true });
        expect(displayed!.settings.customPromptEnabled).toBe(true);
        expect(displayed!.settings.customSystemPrompt).toContain("helpful expert friend");
        await save({ customSystemPrompt: "Answer briefly." });
        await save({ customPromptEnabled: false });
        await save({ customPromptEnabled: true });
        expect(displayed!.settings.customSystemPrompt).toBe("Answer briefly.");
        expect((await engine.getConfig(PANEL_ID)).settings.customPromptEnabled).toBe(true);
    } finally {
        sdk?.close();
        await manager.stopService(PANEL_ID);
        await engine.disposeClients();
        for (const socket of wss.clients) socket.terminate();
        await new Promise<void>((resolve) => wss.close(() => resolve()));
        if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
        auth.dispose();
        fs.rmSync(root, { recursive: true, force: true });
    }
}, 20000);
