import { expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { WebSocketServer, type WebSocket } from "ws";
import { PaperCraneAuth, MAX_PAIRING_FAILURES } from "../papercrane/auth";
import { PaperCraneEngine } from "../papercrane/engine";
import { setupWebSocketServer } from "../papercrane/ws";
import { pinnableWebSocket } from "../papercrane/pinnableWebSocket";

async function withAuth(run: (auth: PaperCraneAuth, advance: () => void, dir: string) => Promise<void> | void): Promise<void> {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pb-pairing-isolation-"));
    let clock = 1_000_000;
    const auth = new PaperCraneAuth(false, dir, () => clock);
    try {
        await run(auth, () => { clock += 60_000; }, dir);
    } finally {
        auth.dispose();
        fs.rmSync(dir, { recursive: true, force: true });
    }
}
const wrongCode = (code: string) => code === "000000" ? "111111" : "000000";

it("wrong codes from peer A do not refuse peer B's correct code over WebSocket", async () => {
    await withAuth(async (auth, _advance, dir) => {
        const local = new WebSocketServer({ port: 0, host: "127.0.0.1" });
        const clients = new Set<WebSocket>();
        const NpmWebSocket = pinnableWebSocket();
        setupWebSocketServer(local, new PaperCraneEngine(dir), auth);
        try {
            if (!local.address()) await once(local, "listening");
            const port = (local.address() as AddressInfo).port;
            async function pair(address: string, code: string): Promise<any> {
                const client = new NpmWebSocket(`ws://127.0.0.1:${port}`, { localAddress: address });
                clients.add(client);
                const timeout = setTimeout(() => client.terminate(), 3000);
                try {
                    await once(client, "open");
                    const response = new Promise<any>((resolve, reject) => {
                        client.once("message", (raw) => resolve(JSON.parse(raw.toString())));
                        client.once("error", reject);
                        client.once("close", () => reject(new Error("Pairing socket closed before response")));
                    });
                    client.send(JSON.stringify({ id: 1, action: "auth:pair", params: { code, clientName: "fixture", peerAddress: "spoofed" } }));
                    return await response;
                } finally {
                    clearTimeout(timeout);
                    client.terminate();
                    clients.delete(client);
                }
            }
            const code = auth.startPairing();
            expect((await pair("127.0.0.2", wrongCode(code))).error).toMatch(/Invalid pairing code/);
            // Reconnecting and client-supplied identity do not bypass A's penalty.
            expect((await pair("127.0.0.2", code)).error).toMatch(/locked/);
            const result = await pair("127.0.0.3", code);
            expect(result.error).toBeUndefined();
            expect(result.result.success).toBe(true);
            expect(auth.verifyHostToken(result.result.token)).toBe(true);
        } finally {
            for (const socket of clients) socket.terminate();
            for (const socket of local.clients) socket.terminate();
            await new Promise<void>((resolve) => local.close(() => resolve()));
        }
    });
});

it("one address exhausts only its own guesses and cannot end the session", async () => {
    await withAuth((auth, advance) => {
        const code = auth.startPairing();
        const wrong = wrongCode(code);
        // Advance past every temporary lockout: the per-address ceiling must
        // still prevent this peer from spending the global session budget.
        for (let n = 0; n <= MAX_PAIRING_FAILURES; n++) {
            auth.pair(wrong, undefined, "192.0.2.1");
            advance();
        }
        expect(auth.isPairingActive()).toBe(true);
        expect(auth.pair(code, undefined, "192.0.2.1").success).toBe(false);
        expect(auth.pair(code, undefined, "192.0.2.2").success).toBe(true);
    });
});

it("a larger global budget still ends distributed guessing and invalidates the code", async () => {
    await withAuth((auth, advance) => {
        const code = auth.startPairing();
        const wrong = wrongCode(code);
        const ended: string[] = [];
        auth.on("pairingCancelled", (reason: string) => ended.push(reason));
        // Ten addresses must not exhaust the larger global session budget.
        for (let n = 1; n <= 10; n++) {
            expect(auth.pair(wrong, undefined, `192.0.2.${n}`).error).toMatch(/Invalid pairing code/);
            advance();
        }
        expect(auth.isPairingActive()).toBe(true);
        for (let n = 11; n < MAX_PAIRING_FAILURES; n++) {
            expect(auth.pair(wrong, undefined, `192.0.2.${n}`).error).toMatch(/Invalid pairing code/);
            advance();
        }
        expect(auth.pair(wrong, undefined, "198.51.100.1").error).toMatch(/Pairing has ended/);
        expect(ended).toEqual(["too-many-failures"]);
        expect(auth.isPairingActive()).toBe(false);
        expect(auth.pair(code, undefined, "198.51.100.2").success).toBe(false);
        const next = auth.startPairing();
        expect(auth.pair(next, undefined, "192.0.2.1").success).toBe(true);
    });
});

it("startPairing and cancelPairing clear peer penalties and escalation", async () => {
    await withAuth((auth, advance) => {
        for (const restart of [() => auth.startPairing(), () => { auth.cancelPairing(); return auth.startPairing(); }]) {
            const code = auth.startPairing();
            for (let n = 0; n < 3; n++) {
                expect(auth.pair(wrongCode(code), undefined, "192.0.2.1").remainingSeconds).toBe(n < 2 ? 5 : 30);
                if (n < 2) advance();
            }
            const next = restart();
            expect(auth.pair(wrongCode(next), undefined, "192.0.2.1").remainingSeconds).toBe(5);
            // Restart once more while locked; a correct code works immediately.
            const final = restart();
            expect(auth.pair(final, undefined, "192.0.2.1").success).toBe(true);
        }
    });
});

it("IPv6 address rotation shares a /64 penalty without blocking other prefixes", async () => {
    await withAuth((auth) => {
        const code = auth.startPairing();
        auth.pair(wrongCode(code), undefined, "2001:db8:abcd:1::1");
        expect(auth.pair(code, undefined, "2001:0DB8:abcd:0001:ffff::2").error).toMatch(/locked/);
        expect(auth.pair(code, undefined, "2001:db8:abcd:2::1").success).toBe(true);
    });
});

it("mapped IPv4 shares its IPv4 penalty without collapsing unrelated IPv4 peers", async () => {
    await withAuth((auth) => {
        const code = auth.startPairing();
        auth.pair(wrongCode(code), undefined, "192.0.2.1");
        expect(auth.pair(code, undefined, "::ffff:c000:201").error).toMatch(/locked/);
        expect(auth.pair(code, undefined, "::ffff:192.0.2.2").success).toBe(true);
    });
});
