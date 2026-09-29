import { test, expect } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { PaperCraneEngine } from "../papercrane/engine";
import { PaperCraneAuth } from "../papercrane/auth";
import { PanelServicesManager } from "../papercrane/panelServices";
import { handlePanels } from "../papercrane/rpc/panels";

const ID = "dev.test.restart";

function fixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "panel-restart-"));
    const dir = path.join(root, "panels", ID);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ id: ID, name: "Restart", version: "0.1.0", service: "service.mjs" }));
    // each generation appends its pid, then reports ready
    fs.writeFileSync(path.join(dir, "service.mjs"), `import fs from 'node:fs';fs.appendFileSync('generations',process.pid+'\\n');process.send({type:'paperboard:service-ready',panelId:${JSON.stringify(ID)}});setInterval(()=>{},1000);`);
    const auth = new PaperCraneAuth(false, path.join(root, "local"));
    const services = new PanelServicesManager(root);
    services.setAuth(auth);
    const engine = new PaperCraneEngine(root, services);
    const generations = () => fs.readFileSync(path.join(dir, "generations"), "utf8").trim().split("\n").map(Number);
    const cleanup = async () => { await services.stopService(ID); auth.dispose(); fs.rmSync(root, { recursive: true, force: true }); };
    return { root, dir, engine, services, generations, cleanup };
}

// signal 0 probes existence; only ESRCH means "no such process"
const alive = (pid: number) => {
    try { process.kill(pid, 0); return true; }
    catch (err: any) {
        if (err?.code !== "ESRCH") throw err;
        console.debug(`pid ${pid} has exited`);
        return false;
    }
};

test("restart stops the old service generation and awaits the new one's readiness", async () => {
    const f = fixture();
    try {
        expect(f.services.startService(ID)).toBe(true);
        await f.services.waitUntilReady(ID);
        const [first] = f.generations();
        expect(await f.engine.restartPanelService(ID)).toBe(true);
        const gens = f.generations();
        expect(gens).toHaveLength(2);
        expect(gens[1]).not.toBe(first);
        expect(alive(first)).toBe(false);
        expect(alive(gens[1])).toBe(true);
    } finally { await f.cleanup(); }
});

test("restart leaves daemon-owned workloads of the panel running", async () => {
    const f = fixture();
    const client = new EventEmitter() as any;
    let killed = false;
    client.isConnected = () => true;
    client.kill = () => { killed = true; };
    try {
        (f.engine as any).clients.set("owned-server", client);
        f.engine.setClientOwner("owned-server", ID);
        expect(await f.engine.restartPanelService(ID)).toBe(true);
        expect(killed).toBe(false);
        expect((f.engine as any).clients.has("owned-server")).toBe(true);
    } finally { (f.engine as any).clients.delete("owned-server"); await f.cleanup(); }
});

test("restart reports false for a panel without a service, and refuses an uninstalled one", async () => {
    const f = fixture();
    try {
        fs.writeFileSync(path.join(f.dir, "manifest.json"), JSON.stringify({ id: ID, name: "Restart", version: "0.1.0" }));
        expect(await f.engine.restartPanelService(ID)).toBe(false);
        await expect(f.engine.restartPanelService("dev.test.absent")).rejects.toThrow(/not installed/);
    } finally { await f.cleanup(); }
});

test("panel:restartService is claim-checked: a scoped caller cannot restart another panel", async () => {
    const calls: string[] = [];
    const replies: { result: any; error?: string; code?: string }[] = [];
    const ctx = {
        engine: { restartPanelService: async (id: string) => { calls.push(id); return true; } },
        callerPanelId: () => "a",
        sendEvent: () => undefined,
        reply: (_id: unknown, result: any, error?: string, code?: string) => replies.push({ result, error, code }),
    };
    await handlePanels("panel:restartService", 1, { panelId: "b" }, ctx as any);
    expect(replies[0].code).toBe("FORBIDDEN");
    expect(calls).toEqual([]);
    await handlePanels("panel:restartService", 2, { panelId: "a" }, ctx as any);
    expect(calls).toEqual(["a"]);
    expect(replies.at(-1)).toEqual({ result: { restarted: true }, error: undefined, code: undefined });
});
