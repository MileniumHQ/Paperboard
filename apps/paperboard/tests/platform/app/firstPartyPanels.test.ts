import { beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import {
    BUILD_TIMEOUT_MS, FIRST_PARTY_PANELS, buildApp, buildCrane, buildPanel, installBuiltPanel,
    type BuiltApp, type BuiltCrane,
} from "./support/build";
import { CraneSocket, startCrane, WAIT_MS } from "./support/crane";
import { domCondition, launchElectron, SHELL, shellReady } from "./support/electron";
import { tempDataDir } from "./support/temp";

const PANEL = "dev.paperboard.terminal";
const FRAME = `panel://local.${PANEL}/`;

let app: BuiltApp;
let crane: BuiltCrane;
beforeAll(async () => {
    [app, crane] = await Promise.all([buildApp(), buildCrane(), ...FIRST_PARTY_PANELS.map(buildPanel)]);
}, BUILD_TIMEOUT_MS);

// A first-party panel works end to end on every target.
describe("first-party panels under the compiled daemon", () => {
    test("every first-party panel's built service starts and reports ready", async () => {
        const dataDir = tempDataDir("panels-services");
        const daemon = await startCrane(crane.file, dataDir);
        const host = await CraneSocket.authed(daemon.handshake.port, daemon.handshake.token);
        await host.call("monitor:subscribe");
        for (const id of FIRST_PARTY_PANELS) {
            await installBuiltPanel(dataDir, id);
            // starts dist/service.js and resolves only once it said ready
            expect(await host.call("panel:restartService", { panelId: id })).toEqual({ restarted: true });
            const ready = await host.waitFrame(`${id} ready`, (f) => f.type === "monitor" && f.record.type === "service" && f.record.panel === id && f.record.state === "ready");
            // the compiled daemon re-runs its own binary for the service
            expect(ready.record.pid).toBeGreaterThan(0);
        }
        expect(await host.call("service:count")).toEqual({ running: FIRST_PARTY_PANELS.length });
        const failed = host.frames.filter((f) => f.type === "monitor" && f.record.type === "service" && ["failed", "exited"].includes(f.record.state));
        expect(failed).toEqual([]);
        host.close();
        await daemon.stop();
    }, WAIT_MS * 4);

    test("the panel's frame opens in the shell with its scoped token, and its config write survives a daemon restart", async () => {
        const dataDir = tempDataDir("panels-frame");
        await installBuiltPanel(dataDir, PANEL);
        const daemon = await startCrane(crane.file, dataDir);
        const electron = await launchElectron({ appDir: app.dir, dataDir, args: ["--skip-update"] });
        await shellReady(electron);

        // open it the way a person does: the computer, then the panel
        await electron.evalIn(SHELL, `document.querySelector('[role=radio][aria-label^="This Computer"]').click()`);
        const item = `document.querySelector('[class*=panelList] label[data-value="${PANEL}"]')`;
        await electron.evalIn(SHELL, domCondition(item));
        await electron.evalIn(SHELL, `${item}.click()`);
        await electron.evalIn(SHELL, domCondition(`document.querySelector('iframe[src^="${FRAME}"]')`));

        const creds = await electron.evalInFrame(FRAME, domCondition("window.__PAPERBOARD_CRANE"));
        expect(creds).toMatchObject({ port: daemon.handshake.port, scoped: true, computerId: "local", panelId: PANEL });
        expect(creds.token).not.toBe(daemon.handshake.token);

        // one round trip from the frame itself, over its own origin and token
        const value = { written: "from the frame", n: 42 };
        const answer = await electron.evalInFrame(FRAME, `new Promise((resolve, reject) => {
            const c = window.__PAPERBOARD_CRANE;
            const ws = new WebSocket("ws://127.0.0.1:" + c.port);
            ws.onerror = () => reject(new Error("panel socket failed"));
            ws.onopen = () => ws.send(JSON.stringify({ id: 1, action: "config:set", params: { token: c.token, id: c.panelId, path: "smoke/roundtrip.json", data: ${JSON.stringify(value)} } }));
            ws.onmessage = (m) => { const r = JSON.parse(m.data); if (r.type === "response") { ws.close(); resolve(r); } };
        })`);
        expect(answer).toMatchObject({ type: "response", id: 1, result: { success: true } });
        expect(electron.failures()).toEqual([]);
        expect(await electron.quit()).toEqual({ code: 0, signal: null });

        await daemon.stop();
        const restarted = await startCrane(crane.file, dataDir);
        // the write is on disk under the panel, and reads back the same
        const host = await CraneSocket.authed(restarted.handshake.port, restarted.handshake.token);
        expect(await host.call("config:get", { id: PANEL, path: "smoke/roundtrip.json" })).toEqual({ data: value });
        host.close();
        await restarted.stop();
        expect(fs.existsSync(path.join(dataDir, "panels", PANEL, "dist", "service.js"))).toBe(true);
    }, WAIT_MS * 4);
});
