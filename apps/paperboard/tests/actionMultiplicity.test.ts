import { test, expect } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { WebSocket, WebSocketServer } from "ws";
import { PaperCraneEngine } from "../papercrane/engine";
import { PaperCraneAuth } from "../papercrane/auth";
import { setupWebSocketServer } from "../papercrane/ws";
import { initPaperApi, closeTransport, actionsApi, getTransport } from "@paperboard-dev/paperapi";

test("two flows sharing one event each execute once through the real SDK and authenticated daemon", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "flow-wire-"));
    const engine = new PaperCraneEngine(root);
    const auth = new PaperCraneAuth(false, path.join(root, "local"));
    const token = auth.issuePanelToken("dev.paperboard.actions");
    const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    setupWebSocketServer(wss, engine, auth);
    await once(wss, "listening");
    let off: () => void = () => undefined;
    try {
        await initPaperApi({ port: (wss.address() as any).port, token, computerId: "local", panelId: "dev.paperboard.actions" });
        const { actionsService } = await import("../../../panels/dev.paperboard.actions/src/service");
        await actionsService.ready;
        const flows = ["first", "second"].map((id) => ({ id, panelId: "dev.paperboard.botcreator", pos: { x: 0, y: 0 }, isTrigger: true,
            action: { id: "on-message", name: "On message" }, values: {}, children: [] }));
        await actionsApi.call("dev.paperboard.actions", "sync-flows", { flows, functions: [] });
        const starts: string[] = [];
        off = actionsApi.onTrigger("dev.paperboard.actions", "flow-start", (data: any) => starts.push(data.triggerBlockId));
        await getTransport("local").call("system:info");
        // the event comes from botcreator's own credential: a panel can only
        // emit triggers under its own claim (tests/actionIdentity.test.ts)
        const bot = new WebSocket(`ws://127.0.0.1:${(wss.address() as any).port}`);
        await once(bot, "open");
        bot.send(JSON.stringify({ id: 1, action: "triggers:emit", params: { token: auth.issuePanelToken("dev.paperboard.botcreator"), panelId: "dev.paperboard.botcreator", trigger: "on-message", output: { content: "fixture" } } }));
        const [ack] = await once(bot, "message");
        expect(JSON.parse(String(ack)).error).toBeUndefined();
        bot.terminate();
        const deadline = Date.now() + 2000;
        while (starts.length < 2 && Date.now() < deadline) await Bun.sleep(5);
        await Bun.sleep(30);
        expect(starts.sort()).toEqual(["first", "second"]);
        await actionsApi.call("dev.paperboard.actions", "sync-flows", { flows: [], functions: [] });
    } finally {
        off(); closeTransport("local");
        for (const socket of wss.clients) socket.terminate();
        await new Promise<void>((resolve) => wss.close(() => resolve()));
        auth.dispose(); fs.rmSync(root, { recursive: true, force: true });
    }
});
