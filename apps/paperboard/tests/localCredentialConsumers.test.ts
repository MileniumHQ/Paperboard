import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { startPaperCraneServer } from "../papercrane/index";
import { craneHandshakePath } from "../papercrane/handshake";
import { PaperCraneClient } from "../src/main/communication/papercrane/PaperCraneClient";
import connectionPool from "../src/main/communication/papercrane/ConnectionPool";
import { createShellInvokeHandlers } from "../src/main/communication/shellHandlers";
import { servePanelAsset } from "../src/main/panelServe";

const panelId = "dev.paperboard.handshake-test";
const forged = { port: 1, token: "pc_forged_handshake" };
const handlers = createShellInvokeHandlers({
    appVersion: () => "0.0.0-test",
    launchOptions: () => ({ firstOpenTutorials: false, mobile: false }),
    openPath: async () => "",
});
let root: string;
let savedDir: string | undefined;
let daemon: Awaited<ReturnType<typeof startPaperCraneServer>> | undefined;
let client: PaperCraneClient;
let restoreClient: (() => void) | undefined;

function forgeHandshake(): void {
    fs.writeFileSync(craneHandshakePath(), JSON.stringify(forged), { mode: 0o600 });
}

beforeEach(async () => {
    savedDir = process.env.PAPERBOARD_DIR;
    root = fs.mkdtempSync(path.join(os.tmpdir(), "pb-credential-consumers-"));
    process.env.PAPERBOARD_DIR = root;
    const dist = path.join(root, "panels", panelId, "dist");
    fs.mkdirSync(dist, { recursive: true });
    fs.writeFileSync(path.join(dist, "index.html"), "<html><head></head><body>panel</body></html>");
    daemon = await startPaperCraneServer({ host: "127.0.0.1", port: 0, headless: true, advertise: false });
    client = new PaperCraneClient();
    // Only select the fixture client. Proof, authentication, RPC issuance,
    // and document serving all run through their real implementations.
    const selection = spyOn(connectionPool, "getClient").mockImplementation((id) => {
        expect(id).toBe("local");
        return client;
    });
    restoreClient = () => selection.mockRestore();
});

afterEach(() => {
    try {
        restoreClient?.();
        restoreClient = undefined;
        client?.disconnect();
        daemon?.stop();
    } finally {
        daemon = undefined;
        if (savedDir === undefined) delete process.env.PAPERBOARD_DIR;
        else process.env.PAPERBOARD_DIR = savedDir;
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test("crane-credentials stays retryable when only a forged handshake is available", () => {
    forgeHandshake();
    expect(() => handlers["crane-credentials"](undefined)).toThrow("CRANE_NOT_READY");
});

test("crane-credentials returns the verified client's values instead of a forged file", async () => {
    await client.connect("127.0.0.1");
    const verified = client.getLocalCredentials()!;
    forgeHandshake();
    expect(handlers["crane-credentials"](undefined)).toEqual({ ...verified, computerId: "local" });
});

test("panel serving refuses a forged handshake even when an unverified client can issue a token", async () => {
    const stored = JSON.parse(fs.readFileSync(craneHandshakePath(), "utf8"));
    // Explicit-token connections authenticate but do not prove local identity.
    // Let the real RPC succeed so the test isolates the injection boundary.
    await client.connect("127.0.0.1", stored.port, stored.token);
    expect(client.getLocalCredentials()).toBeNull();
    forgeHandshake();
    const response = await servePanelAsset("local", panelId, "index.html");
    expect(response.ok).toBe(false);
    expect(await response.text()).not.toContain("window.__PAPERBOARD_CRANE");
});

test("panel serving uses the verified port and only the daemon-issued panel token", async () => {
    await client.connect("127.0.0.1");
    const verified = client.getLocalCredentials()!;
    forgeHandshake();
    const response = await servePanelAsset("local", panelId, "index.html");
    expect(response.status).toBe(200);
    const html = await response.text();
    const payload = JSON.parse(html.match(/window\.__PAPERBOARD_CRANE=(.*?);<\/script>/)![1]);
    expect(payload).toEqual({
        port: verified.port,
        token: expect.any(String),
        scoped: true,
        computerId: "local",
        panelId,
    });
    expect(html).not.toContain(verified.token);
    expect(html).not.toContain(forged.token);
    const panelClient = new PaperCraneClient();
    try {
        await panelClient.connect("127.0.0.1", payload.port, payload.token);
        // A working token that cannot issue host credentials is scoped.
        await expect(panelClient.call("auth:panel-token", { panelId })).rejects.toThrow();
    } finally {
        panelClient.disconnect();
    }
});

test("panel serving rechecks verified credentials after the panel-token RPC completes", async () => {
    await client.connect("127.0.0.1");
    forgeHandshake();
    const call = client.call.bind(client);
    const issuance = spyOn(client, "call").mockImplementation(async <T>(...args: Parameters<PaperCraneClient["call"]>): Promise<T> => {
        const result = await call<T>(...args);
        if (args[0] === "auth:panel-token") client.disconnect();
        return result;
    });
    try {
        const response = await servePanelAsset("local", panelId, "index.html");
        expect(response.ok).toBe(false);
        expect(await response.text()).not.toContain("window.__PAPERBOARD_CRANE");
    } finally {
        issuance.mockRestore();
    }
});
