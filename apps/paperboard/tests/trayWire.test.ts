import { test, expect } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { once } from "node:events";
import { WebSocketServer } from "ws";
import { PaperCraneAuth } from "../papercrane/auth";
import { PaperCraneEngine } from "../papercrane/engine";
import { PanelServicesManager } from "../papercrane/panelServices";
import { setupWebSocketServer } from "../papercrane/ws";
import { PaperCraneClient } from "../src/main/communication/papercrane/PaperCraneClient";
import { trayMenu } from "../src/main/traySummary";
import { pollTrayCount } from "../src/main/trayCount";

const PANEL = "dev.test.tray";
const unusedTrayAction = () => { /* Count-only integration fixture. */ };

test("authenticated daemon count reaches the tray across child start, exit and stop", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "paperboard-tray-wire-"));
    const dir = path.join(root, "panels", PANEL);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ id: PANEL, name: "Tray", version: "0.1.0", service: "service.mjs" }));
    fs.writeFileSync(path.join(dir, "service.mjs"), `
import fs from 'node:fs';
process.send({type:'paperboard:service-ready',panelId:${JSON.stringify(PANEL)}});
setInterval(() => { if (fs.existsSync('exit')) process.exit(0); }, 10);
`);
    const auth = new PaperCraneAuth(false, path.join(root, "local"));
    auth.injectToken("tray-host", "host");
    const services = new PanelServicesManager(root);
    services.setAuth(auth);
    const engine = new PaperCraneEngine(root, services);
    const server = http.createServer();
    const wss = new WebSocketServer({ server });
    setupWebSocketServer(wss, engine, auth);
    const client = new PaperCraneClient();
    let stopPoll: (() => void) | undefined;
    let menu = trayMenu(null, unusedTrayAction, unusedTrayAction);
    const waitForLabel = async (label: string) => {
        const deadline = Date.now() + 2000;
        while (menu[2].label !== label) {
            if (Date.now() > deadline) throw new Error(`Tray did not show ${label}; got ${menu[2].label}`);
            await Bun.sleep(5);
        }
    };
    try {
        server.listen(0, "127.0.0.1");
        await once(server, "listening");
        await client.connect("127.0.0.1", (server.address() as { port: number }).port, "tray-host");
        stopPoll = pollTrayCount({
            read: () => client.runningServiceCount(),
            render: (count) => { menu = trayMenu(count, unusedTrayAction, unusedTrayAction); },
            onError: (error) => { throw error; },
        }, 5);
        await waitForLabel("Paperboard · 0 panels running");
        expect(services.startService(PANEL)).toBe(true);
        await services.waitUntilReady(PANEL);
        await waitForLabel("Paperboard · 1 panel running");
        fs.writeFileSync(path.join(dir, "exit"), "");
        // A crashed child's record remains for delayed restart; it is not running.
        await waitForLabel("Paperboard · 0 panels running");
        await services.stopService(PANEL);
        fs.unlinkSync(path.join(dir, "exit"));
        expect(services.startService(PANEL)).toBe(true);
        await services.waitUntilReady(PANEL);
        await waitForLabel("Paperboard · 1 panel running");
        await services.stopService(PANEL);
        await waitForLabel("Paperboard · 0 panels running");
    } finally {
        stopPoll?.(); client.disconnect();
        await services.stopService(PANEL);
        for (const socket of wss.clients) socket.terminate();
        wss.close();
        await new Promise<void>((resolve) => server.close(() => resolve()));
        auth.dispose();
        fs.rmSync(root, { recursive: true, force: true });
    }
}, 10_000);
