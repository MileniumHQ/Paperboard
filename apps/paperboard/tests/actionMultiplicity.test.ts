import { test, expect } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { WebSocket, WebSocketServer } from "ws";
import { PaperCraneEngine } from "../papercrane/engine";
import { PaperCraneAuth } from "../papercrane/auth";
import { setupWebSocketServer } from "../papercrane/ws";
import { initPaperApi, closeTransport, actionsApi, config, getTransport } from "@mileniumhq/paperapi";
import { commandTriggerId } from "../../../panels/dev.paperboard.botcreator/src/types";
import { createCanvasSync } from "../../../panels/dev.paperboard.actions/src/lib/canvasSync";

test("startup cannot overwrite an accepted flow sync; slash commands stay scoped and shared events run once", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "flow-wire-"));
    const engine = new PaperCraneEngine(root);
    const auth = new PaperCraneAuth(false, path.join(root, "local"));
    const token = auth.issuePanelToken("dev.paperboard.actions");
    const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    setupWebSocketServer(wss, engine, auth);
    await once(wss, "listening");
    let off: () => void = () => undefined;
    const originalGet = config.get;
    let releaseRead!: () => void;
    let readStarted!: () => void;
    const heldRead = new Promise<void>((resolve) => { releaseRead = resolve; });
    const reading = new Promise<void>((resolve) => { readStarted = resolve; });
    let serviceReady: Promise<void> | undefined;
    const sync = createCanvasSync<{ flows: any[]; functions: any[] }>({
        save: (snapshot) => config.set(snapshot, "dev.paperboard.actions", "canvas.json"),
        apply: (snapshot) => actionsApi.call("dev.paperboard.actions", "sync-flows", snapshot),
        onState: () => {},
    });
    try {
        await initPaperApi({ port: (wss.address() as any).port, token, computerId: "local", panelId: "dev.paperboard.actions" });
        await config.set({ flows: [], functions: [] }, "dev.paperboard.actions", "canvas.json");
        // Delay delivery of the real daemon's old canvas response. The
        // resource read, SDK call, authentication and routing stay real.
        config.get = (async (...args: Parameters<typeof config.get>) => {
            const saved = await originalGet(...args);
            if (args[1] === "canvas.json") { readStarted(); await heldRead; }
            return saved;
        }) as typeof config.get;
        const { actionsService } = await import("../../../panels/dev.paperboard.actions/src/service");
        serviceReady = actionsService.ready;
        await reading;
        const flows = ["first", "second"].map((id) => ({ id, panelId: "dev.paperboard.botcreator", pos: { x: 0, y: 0 }, isTrigger: true,
            action: { id: "on-message", name: "On message" }, values: {}, children: [] }));
        const commands = flows.map((flow, i) => ({ ...flow,
            action: { id: commandTriggerId({ scope: "global", name: i === 0 ? "first" : "second" }), name: "Slash command" } }));
        await config.set({ flows: [commands[0]], functions: [] }, "dev.paperboard.actions", "canvas.json");
        let synced = false;
        const earlySync = actionsApi.call("dev.paperboard.actions", "sync-flows", { flows: [commands[0]], functions: [] })
            .then((result) => { synced = true; return result; });
        await getTransport("local").call("system:info");
        await Bun.sleep(20);
        expect(synced).toBe(false);
        releaseRead();
        await actionsService.ready;
        await earlySync;
        config.get = originalGet;
        expect(actionsService.getState().flowCount).toBe(1);
        const starts: string[] = [];
        off = actionsApi.onTrigger("dev.paperboard.actions", "flow-start", (data: any) => starts.push(data.triggerBlockId));
        await getTransport("local").call("system:info");
        // the event comes from botcreator's own credential: a panel can only
        // emit triggers under its own claim (tests/actionIdentity.test.ts)
        const bot = new WebSocket(`ws://127.0.0.1:${(wss.address() as any).port}`);
        await once(bot, "open");
        let request = 0;
        const emit = async (trigger: string, expected: string[]) => {
            starts.length = 0;
            bot.send(JSON.stringify({ id: ++request, action: "triggers:emit", params: { token: auth.issuePanelToken("dev.paperboard.botcreator"), panelId: "dev.paperboard.botcreator", trigger, output: { content: "fixture" } } }));
            const [ack] = await once(bot, "message");
            expect(JSON.parse(String(ack)).error).toBeUndefined();
            const deadline = Date.now() + 2000;
            while (starts.length < expected.length && Date.now() < deadline) await Bun.sleep(5);
            await Bun.sleep(30);
            expect(starts.sort()).toEqual(expected.sort());
        };
        await emit(commands[0].action.id, ["first"]);
        sync.schedule({ flows: commands, functions: [] });
        expect(await sync.flush()).toEqual({ ok: true });
        expect((await config.get<any>("dev.paperboard.actions", "canvas.json")).flows).toEqual(commands);
        await emit(commands[1].action.id, ["second"]);
        await emit(commands[0].action.id, ["first"]);
        sync.schedule({ flows, functions: [] });
        expect(await sync.flush()).toEqual({ ok: true });
        await emit("on-message", ["first", "second"]);
        bot.terminate();
        await actionsApi.call("dev.paperboard.actions", "sync-flows", { flows: [], functions: [] });
        await getTransport("local").call("system:info");
    } finally {
        sync.dispose(); releaseRead(); config.get = originalGet;
        try {
            await serviceReady;
            await getTransport("local").call("system:info");
        } finally {
            off(); closeTransport("local");
            for (const socket of wss.clients) socket.terminate();
            await new Promise<void>((resolve) => wss.close(() => resolve()));
            auth.dispose(); fs.rmSync(root, { recursive: true, force: true });
        }
    }
});
