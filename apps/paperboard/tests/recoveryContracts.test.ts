import { test, expect } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { PaperCraneEngine } from "../papercrane/engine";
import { PaperCraneAuth } from "../papercrane/auth";
import { PanelServicesManager } from "../papercrane/panelServices";
import { CredentialStore } from "../papercrane/credentials";
import { resolveDavPath } from "../papercrane/dav";
import { startFixtureRegistry, manifestFile, FIXTURE_RELEASE_PUBLIC_KEY } from "./registryFixture";

test("upgrade observes new service behavior; failed activation restores usable previous bytes", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "panel-upgrade-"));
    const auth = new PaperCraneAuth(false, path.join(root, "local"));
    const services = new PanelServicesManager(root);
    services.setAuth(auth);
    const registry = await startFixtureRegistry(root);
    const engine = new PaperCraneEngine(root, services, registry.url, FIXTURE_RELEASE_PUBLIC_KEY);
    const server = registry;
    const install = async (version: string, fail = false) => {
        await registry.publish("dev.test.running", version, {
            "manifest.json": manifestFile("dev.test.running", version, { service: "service.mjs" }),
            "service.mjs": fail ? "process.exit(7)" : `import fs from 'node:fs';fs.writeFileSync('running-version',${JSON.stringify(version)});process.send({type:'paperboard:service-ready',panelId:'dev.test.running'});setInterval(()=>{},1000);`,
        });
        return engine.installPanel("dev.test.running", { version });
    };
    try {
        await install("0.1.0");
        await install("0.2.0");
        expect(fs.readFileSync(engine.resolvePath("panels", "dev.test.running", "running-version"), "utf8")).toBe("0.2.0");
        await expect(install("0.3.0", true)).rejects.toThrow();
        expect((await engine.listPanels())[0].version).toBe("0.2.0");
        expect(fs.readFileSync(engine.resolvePath("panels", "dev.test.running", "running-version"), "utf8")).toBe("0.2.0");
        await engine.setConfig("dev.test.running", { retained: true });
        await engine.writeFile("world.dat", "world bytes", "dev.test.running");
        engine.setSecret("token", "fixture", "dev.test.running");
        await engine.uninstallPanel("dev.test.running");
        const recovery = fs.readdirSync(engine.resolvePath("panels")).filter((name) => name.startsWith(".trash-")).sort().at(-1)!;
        await engine.restorePanel("dev.test.running", recovery);
        expect(await engine.readFile("world.dat", "dev.test.running")).toBe("world bytes");
        expect(await engine.getConfig("dev.test.running")).toEqual({ retained: true });
        expect(engine.getSecret("token", "dev.test.running").value).toBe("fixture");
    } finally { await services.stopService("dev.test.running"); auth.dispose(); await server.stop(); fs.rmSync(root, { recursive: true, force: true }); }
});

test("uninstall uses the owner of mc-server and waits for observed exit before removal", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "owned-removal-"));
    const engine = new PaperCraneEngine(root);
    let running = true;
    const client = new EventEmitter() as any;
    client.isConnected = () => running;
    client.kill = () => setTimeout(() => { running = false; client.emit("exit", 0); }, 20);
    client.destroy = () => { expect(running).toBe(false); client.removeAllListeners(); };
    try {
        (engine as any).clients.set("mc-server", client);
        engine.setClientOwner("mc-server", "dev.paperboard.gameserver");
        await engine.uninstallPanel("dev.paperboard.gameserver");
        expect(running).toBe(false);
        expect((engine as any).clients.has("mc-server")).toBe(false);
    } finally { client.removeAllListeners(); fs.rmSync(root, { recursive: true, force: true }); }
});

test("vault purge retains owner-only recovery and restores actual secrets outside DAV", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "vault-restore-"));
    try {
        const store = new CredentialStore(root);
        store.set("key", "value", "panel.a");
        expect(store.purge("panel.a")).toBe(1);
        const dir = path.join(root, "local", "vault-recovery");
        const record = fs.readdirSync(dir)[0];
        expect(resolveDavPath(root, `/local/vault-recovery/${record}`)).toBeNull();
        expect(fs.statSync(path.join(dir, record)).mode & 0o777).toBe(0o600);
        store.restoreRecovery(record, "panel.a");
        expect(store.get("key", "panel.a").value).toBe("value");
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("independent documents survive writes and corrupt configuration refuses without overwriting", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "config-documents-"));
    const engine = new PaperCraneEngine(root);
    try {
        await engine.setConfig("panel.a", { tabs: [1] }, "tabs.json");
        await engine.setConfig("panel.a", { flows: [2] }, "canvas.json");
        expect(await engine.getConfig("panel.a", "tabs.json")).toEqual({ tabs: [1] });
        fs.writeFileSync(engine.resolvePath("configs", "panel.a.json"), "corrupt");
        await expect(engine.getConfig("panel.a")).rejects.toThrow();
        expect(fs.readFileSync(engine.resolvePath("configs", "panel.a.json"), "utf8")).toBe("corrupt");
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
