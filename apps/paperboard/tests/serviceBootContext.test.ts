import { test, expect } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PanelServicesManager } from "../papercrane/panelServices";
import { PaperCraneAuth } from "../papercrane/auth";

test("two delayed child services keep separate credentials; stop waits for exit and cancels restart", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "service-lifecycle-"));
    const auth = new PaperCraneAuth(false, path.join(root, "local"));
    const manager = new PanelServicesManager(root);
    manager.setAuth(auth);
    try {
        for (const id of ["panel.a", "panel.b"]) {
            const dir = path.join(root, "panels", id);
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ id, name: id, service: "service.mjs" }));
            fs.writeFileSync(path.join(dir, "service.mjs"), `import fs from 'node:fs';
await new Promise(r=>setTimeout(r,40));
fs.writeFileSync('receipt.json',JSON.stringify({id:process.env.PAPERBOARD_PANEL_ID,token:process.env.PAPERCRANE_PANEL_TOKEN,master:process.env.PAPERCRANE_TOKEN}));
process.on('SIGTERM',()=>{});
process.send({type:'paperboard:service-ready',panelId:process.env.PAPERBOARD_PANEL_ID});
setInterval(()=>{},1000);`);
            expect(manager.startService(id)).toBe(true);
        }
        await Promise.all([manager.waitUntilReady("panel.a"), manager.waitUntilReady("panel.b")]);
        for (const id of ["panel.a", "panel.b"]) {
            const receipt = JSON.parse(fs.readFileSync(path.join(root, "panels", id, "receipt.json"), "utf8"));
            expect(receipt.id).toBe(id);
            expect(auth.matchToken(receipt.token)?.panelId).toBe(id);
            expect(receipt.master).toBeUndefined();
            await manager.stopService(id, 20);
        }
        await Bun.sleep(1100);
        expect((manager as any).services.size).toBe(0);
    } finally { manager.stopAll(); auth.dispose(); fs.rmSync(root, { recursive: true, force: true }); }
});
