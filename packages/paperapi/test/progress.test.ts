// file and package download progress listeners unsubscribe on completion
import { describe, test, expect, beforeEach, afterEach } from "bun:test";

type Listener = (e?: any) => void;

class MockWebSocket {
    static instances: MockWebSocket[] = [];
    readyState = 0;
    sent: string[] = [];
    private listeners = new Map<string, Listener[]>();

    constructor(public url: string) {
        MockWebSocket.instances.push(this);
    }

    addEventListener(event: string, cb: Listener) {
        const arr = this.listeners.get(event) ?? [];
        arr.push(cb);
        this.listeners.set(event, arr);
    }

    send(data: string) {
        if (this.readyState !== 1) throw new Error("MockWebSocket not open");
        this.sent.push(data);
        const frame = JSON.parse(data);
        if (frame.action === "auth:verify") queueMicrotask(() => this.receive({ type: "response", id: frame.id, result: { success: true } }));
    }

    close() {
        if (this.readyState === 3) return;
        this.readyState = 3;
        queueMicrotask(() => this.emit("close", {}));
    }

    emit(event: string, e: any = {}) {
        for (const cb of this.listeners.get(event) ?? []) cb(e);
    }

    open() {
        this.readyState = 1;
        this.emit("open", {});
    }

    receive(obj: unknown) {
        this.emit("message", {
            data: typeof obj === "string" ? obj : JSON.stringify(obj),
        });
    }

    frames(): any[] {
        return this.sent.map((s) => JSON.parse(s));
    }
}

const LAST = () => MockWebSocket.instances[MockWebSocket.instances.length - 1];

async function waitFor(cond: () => boolean, ms = 3000): Promise<void> {
    const start = Date.now();
    while (!cond()) {
        if (Date.now() - start > ms) throw new Error("waitFor timeout");
        await new Promise((r) => setTimeout(r, 5));
    }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

import { initPaperApi, getTransport } from "../src/ipc";
import { fileApi } from "../src/file";
import { packageApi } from "../src/package";

async function connect(): Promise<void> {
    const connecting = initPaperApi({ port: 1234, token: "tok" });
    await waitFor(() => MockWebSocket.instances.length > 0);
    LAST().open();
    await connecting;
}

function sendProgress(downloadId: string, stage: string): void {
    LAST().receive({
        type: "event",
        event: "progress",
        payload: { downloadId, stage, percent: stage === "completed" ? 100 : 50 },
    });
}

describe("download progress listener lifetime", () => {
    beforeEach(() => {
        MockWebSocket.instances = [];
        (globalThis as any).WebSocket = MockWebSocket;
    });

    afterEach(() => {
        getTransport("local").close();
        (globalThis as any).WebSocket = undefined;
    });

    test("fileApi.download stops forwarding progress after completed", async () => {
        await connect();

        const stages: string[] = [];
        const running = fileApi.download({
            url: "https://example.com/x.bin",
            targetPath: "/tmp/x.bin",
            appId: "dev.test.panel",
            onProgress(p) {
                stages.push(p.stage);
            },
        });

        // grab the downloadId the client generated from the invoke frame
        await waitFor(() => LAST().frames().some((f) => f.action === "file:download"));
        const frame = LAST().frames().find((f) => f.action === "file:download")!;
        const realId = frame.params.downloadId;
        LAST().receive({ type: "response", id: frame.id, result: "ok" });

        sendProgress(realId, "downloading");
        sendProgress(realId, "completed");
        // progress arriving after the listener unsubscribed must be dropped
        sendProgress(realId, "downloading");
        sendProgress(realId, "error");

        await running;
        await sleep(10);

        expect(stages).toEqual(["downloading", "completed"]);
    });

    test("packageApi.download stops forwarding progress after error", async () => {
        await connect();

        const stages: string[] = [];
        const running = packageApi.download("node", (p) => stages.push(p.stage));

        await waitFor(() => LAST().frames().some((f) => f.action === "package:download"));
        const frame = LAST().frames().find((f) => f.action === "package:download")!;
        const realId = frame.params.downloadId;
        LAST().receive({ type: "response", id: frame.id, result: "/pkg/node" });

        sendProgress(realId, "checking");
        sendProgress(realId, "error");
        sendProgress(realId, "downloading");
        sendProgress(realId, "completed");

        await running;
        await sleep(10);

        expect(stages).toEqual(["checking", "error"]);
    });
});
