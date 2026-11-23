import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { BUILD_TIMEOUT_MS, buildCrane } from "../platform/app/support/build";
import { CraneSocket, startCrane, WAIT_MS, type RunningCrane } from "../platform/app/support/crane";
import { tempDataDir } from "../platform/app/support/temp";

const PANEL = "dev.paperboard.monitored";
const SECRETS = ["hunter2-config-value", "s3cr3t-vault-value", "env-secret-value"];

let daemon: RunningCrane;
let host: CraneSocket;
let panelToken: string;
beforeAll(async () => {
    const crane = await buildCrane();
    daemon = await startCrane(crane.file, tempDataDir("monitor"));
    host = await CraneSocket.authed(daemon.handshake.port, daemon.handshake.token);
    panelToken = (await host.call("auth:panel-token", { panelId: PANEL })).token;
}, BUILD_TIMEOUT_MS);
afterAll(async () => {
    host?.close();
    await daemon?.stop();
});

// what a panel does that carries secrets in its values, inputs and env
async function panelTraffic(): Promise<void> {
    const panel = await CraneSocket.authed(daemon.handshake.port, panelToken);
    await panel.call("config:set", { id: PANEL, data: { password: SECRETS[0] } });
    await panel.call("secrets:set", { panelId: PANEL, name: "api-key", value: SECRETS[1] });
    await panel.call("process:run", { id: "monitored-job", command: process.execPath, args: ["-e", "0"], env: { API_KEY: SECRETS[2] } });
    panel.close();
}

// The traffic monitor redacts and is host-only.
describe("traffic monitor", () => {
    test("this computer's host sees calls, events and workload states, with values, inputs, env and tokens only as their shape", async () => {
        const watcher = await CraneSocket.authed(daemon.handshake.port, daemon.handshake.token);
        expect(await watcher.call("monitor:subscribe")).toMatchObject({ success: true });
        await panelTraffic();
        const set = await watcher.waitFrame("config:set record", (f) => f.type === "monitor" && f.record.method === "config:set");
        expect(set.record).toMatchObject({ type: "rpc", panel: PANEL, ok: true, args: { id: PANEL, data: { type: "object", keys: ["password"] } } });
        const secret = await watcher.waitFrame("secrets:set record", (f) => f.type === "monitor" && f.record.method === "secrets:set");
        expect(secret.record.args).toEqual({ panelId: PANEL, name: "api-key", value: { type: "string", size: SECRETS[1].length } });
        const run = await watcher.waitFrame("process:run record", (f) => f.type === "monitor" && f.record.method === "process:run");
        expect(run.record.args.env).toEqual({ type: "object", keys: ["API_KEY"] });
        await watcher.waitFrame("workload record", (f) => f.type === "monitor" && f.record.type === "workload" && f.record.id === "monitored-job");
        const everything = JSON.stringify(watcher.frames);
        for (const value of [...SECRETS, panelToken, daemon.handshake.token]) expect(everything).not.toContain(value);
        watcher.close();
    }, WAIT_MS);

    test("panel, relay and paired-computer tokens are refused", async () => {
        const { code } = await host.call("system:pairing-start");
        const pairing = await CraneSocket.open(daemon.handshake.port);
        const { token: paired } = await pairing.call("auth:pair", { code, clientName: "laptop" });
        pairing.close();
        const relay = (await host.call("auth:panel-token", { panelId: PANEL, relayTo: "rack" })).token;
        for (const token of [panelToken, paired, relay]) {
            const socket = await CraneSocket.authed(daemon.handshake.port, token);
            const refused = await socket.send("monitor:subscribe");
            expect(refused.code).toBe("FORBIDDEN");
            expect(refused.result).toBeNull();
            socket.close();
        }
    }, WAIT_MS);
});
