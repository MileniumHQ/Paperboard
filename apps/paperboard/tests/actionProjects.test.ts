// action projects over the daemon's real WebSocket (bun test): a panel
// defines projects, registers "project/action" into them, and removing a
// project (or closing its socket) takes its actions with it.
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { WebSocketServer, WebSocket } from "ws";
import type { AddressInfo } from "net";
import { setupWebSocketServer } from "../papercrane/ws";
import { PaperCraneEngine } from "../papercrane/engine";
import { PaperCraneAuth } from "../papercrane/auth";
import { actionsRegistry } from "../papercrane/actions";

let tmp = "";
let wss: WebSocketServer;
let port = 0;
let nextId = 1;

beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pb-actionprojects-"));
    const engine = new PaperCraneEngine(tmp);
    const auth = new PaperCraneAuth(true, tmp);
    wss = new WebSocketServer({ port: 0 });
    setupWebSocketServer(wss, engine, auth, {});
    await new Promise<void>((resolve) => wss.on("listening", () => resolve()));
    port = (wss.address() as AddressInfo).port;
});

afterAll(() => {
    for (const client of wss.clients) client.terminate();
    wss.close();
    fs.rmSync(tmp, { recursive: true, force: true });
});

interface Client {
    ws: WebSocket;
    frames: any[];
}

function connect(): Promise<Client> {
    return new Promise((resolve, reject) => {
        const frames: any[] = [];
        const ws = new WebSocket(`ws://127.0.0.1:${port}`);
        ws.on("message", (raw: Buffer) => frames.push(JSON.parse(raw.toString("utf8"))));
        ws.on("open", () => resolve({ ws, frames }));
        ws.on("error", reject);
    });
}

async function rpc(client: Client, action: string, params: unknown): Promise<any> {
    const id = nextId++;
    client.ws.send(JSON.stringify({ id, action, params }));
    const start = Date.now();
    for (;;) {
        const frame = client.frames.find((f) => f.id === id);
        if (frame) return frame;
        if (Date.now() - start > 3000) throw new Error(`no reply to ${action}`);
        await new Promise((r) => setTimeout(r, 5));
    }
}

const until = async (pred: () => boolean) => {
    const start = Date.now();
    while (!pred()) {
        if (Date.now() - start > 3000) throw new Error("until timeout");
        await new Promise((r) => setTimeout(r, 5));
    }
};

describe("action projects", () => {
    it("lists a project's actions with their project, and removing the project removes them", async () => {
        const a = await connect();
        try {
            expect((await rpc(a, "actions:project-define", { panelId: "dev.proj", project: "server1", name: "Survival" })).error).toBeFalsy();
            expect((await rpc(a, "actions:register", { panelId: "dev.proj", action: "server1/send", schema: { id: "server1/send", name: "Send" } })).error).toBeFalsy();
            expect((await rpc(a, "actions:register", { panelId: "dev.proj", action: "create-server" })).error).toBeFalsy();

            const listed = (await rpc(a, "actions:list", { panelId: "dev.proj" })).result.actions;
            expect(listed.find((x: any) => x.action === "server1/send").project).toBe("server1");
            expect(listed.find((x: any) => x.action === "create-server").project).toBeUndefined();
            expect((await rpc(a, "actions:projects", { panelId: "dev.proj" })).result.projects).toEqual([
                { panelId: "dev.proj", id: "server1", name: "Survival" },
            ]);

            // renaming keeps the actions
            await rpc(a, "actions:project-define", { panelId: "dev.proj", project: "server1", name: "Creative", icon: "dns" });
            expect(actionsRegistry.listProjects("dev.proj")[0]).toMatchObject({ name: "Creative", icon: "dns" });
            expect(actionsRegistry.list("dev.proj").some((x) => x.action === "server1/send")).toBe(true);

            expect((await rpc(a, "actions:project-remove", { panelId: "dev.proj", project: "server1" })).error).toBeFalsy();
            expect(actionsRegistry.list("dev.proj").map((x) => x.action)).toEqual(["create-server"]);
            expect(actionsRegistry.listProjects("dev.proj")).toEqual([]);

            // a call to the removed project's action fails loudly
            const call = await rpc(a, "actions:call", { panelId: "dev.proj", action: "server1/send", args: [] });
            expect(call.error).toContain("not registered");
        } finally {
            a.ws.terminate();
        }
    });

    it("refuses an action into a project that isn't defined, or defined by another socket", async () => {
        const a = await connect();
        const b = await connect();
        try {
            const undefinedProject = await rpc(a, "actions:register", { panelId: "dev.proj2", action: "nope/send" });
            expect(undefinedProject.code).toBe("INVALID_PARAMS");
            expect(undefinedProject.error).toContain('Project "nope" is not defined');

            await rpc(a, "actions:project-define", { panelId: "dev.proj2", project: "bot", name: "Bot" });
            const foreign = await rpc(b, "actions:register", { panelId: "dev.proj2", action: "bot/send" });
            expect(foreign.code).toBe("INVALID_PARAMS");
            const steal = await rpc(b, "actions:project-define", { panelId: "dev.proj2", project: "bot", name: "Mine" });
            expect(steal.code).toBe("CONFLICT");

            const twoSlashes = await rpc(a, "actions:register", { panelId: "dev.proj2", action: "bot/a/b" });
            expect(twoSlashes.code).toBe("INVALID_PARAMS");
            const badId = await rpc(a, "actions:project-define", { panelId: "dev.proj2", project: "has space", name: "X" });
            expect(badId.code).toBe("INVALID_PARAMS");
        } finally {
            a.ws.terminate();
            b.ws.terminate();
        }
    });

    it("a closed socket's projects and their actions are gone", async () => {
        const a = await connect();
        await rpc(a, "actions:project-define", { panelId: "dev.proj3", project: "p", name: "P" });
        await rpc(a, "actions:register", { panelId: "dev.proj3", action: "p/go" });
        a.ws.terminate();
        await until(() => actionsRegistry.listProjects("dev.proj3").length === 0);
        expect(actionsRegistry.list("dev.proj3")).toEqual([]);
    });
});
