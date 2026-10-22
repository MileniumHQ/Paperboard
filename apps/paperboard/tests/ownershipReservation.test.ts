import { afterEach, beforeEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PaperCraneEngine } from "../papercrane/engine";
import { handleProcess } from "../papercrane/rpc/process";
import { handleTerminal } from "../papercrane/rpc/terminal";
import { claimClient } from "../papercrane/rpc/ownership";

let root: string;
let engine: PaperCraneEngine;
beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ownership-reservation-"));
    engine = new PaperCraneEngine(root);
});
afterEach(async () => {
    await engine.disposeClients();
    fs.rmSync(root, { recursive: true, force: true });
});
const ctx = (claim: string | null) => ({ engine, callerPanelId: () => claim, reply: () => undefined, sendEvent: () => undefined }) as any;

for (const action of ["process:write", "process:attach", "process:kill", "process:run", "term:write", "term:attach", "term:destroy", "term:create", "term:resize"]) {
    test(`${action} cannot cross a pending ownership reservation`, async () => {
        const entered = Promise.withResolvers<void>();
        const gate = Promise.withResolvers<void>();
        const starting = claimClient("pending", ctx("panel.a"), "process:run", async () => {
            entered.resolve();
            await gate.promise;
            throw new Error("deterministic start failure");
        });
        // Observe the failure even when an assertion throws before teardown.
        const failed = starting.catch((err) => err);
        try {
            await entered.promise;
            const handler = action.startsWith("process:") ? handleProcess : handleTerminal;
            await expect(handler(action, 1, { id: "pending", command: "unused", data: "foreign", cols: 80, rows: 24 }, ctx("panel.b"))).rejects.toMatchObject({ code: "FORBIDDEN" });
        } finally {
            gate.resolve();
            expect((await failed).message).toBe("deterministic start failure");
        }
        expect(engine.clientOwner("pending")).toBeNull();
        const ledger = path.join(root, "local/process-owners.json");
        if (fs.existsSync(ledger)) expect(JSON.parse(fs.readFileSync(ledger, "utf8"))).not.toHaveProperty("pending");
    });
}

test("overlapping host start cannot invalidate a pending panel reservation; failure restores the previous owner", async () => {
    engine.setClientOwner("pending", "panel.previous");
    const gate = Promise.withResolvers<void>();
    const entered = Promise.withResolvers<void>();
    const starting = claimClient("pending", ctx(null), "process:run", async () => {
        entered.resolve();
        await gate.promise;
        throw new Error("start failed");
    }).catch((err) => err);
    try {
        await entered.promise;
        await expect(claimClient("pending", ctx(null), "process:run", async () => undefined)).rejects.toMatchObject({ code: "CONFLICT" });
    } finally {
        gate.resolve();
        expect((await starting).message).toBe("start failed");
    }
    expect(engine.clientOwner("pending")).toBe("panel.previous");
    expect(JSON.parse(fs.readFileSync(path.join(root, "local/process-owners.json"), "utf8"))).toEqual({ pending: "panel.previous" });
});
