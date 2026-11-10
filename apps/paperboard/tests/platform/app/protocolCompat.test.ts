import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import { PROTOCOL_VERSION } from "../../../papercrane/protocol";
import { DAEMON_CHALLENGE_HEADER, DAEMON_PROOF_TYPE, daemonProof } from "../../../papercrane/handshake";
import { PaperCraneClient } from "../../../src/main/communication/papercrane/PaperCraneClient";
import { BUILD_TIMEOUT_MS, compileCrane, type BuiltCrane } from "./support/build";
import { CraneSocket, startCrane, WAIT_MS } from "./support/crane";
import { tempDataDir } from "./support/temp";

// The previous release's wire contract, pinned. A new contract file is
// added when a release changes the wire; this one is never edited.
const contract = JSON.parse(fs.readFileSync(path.join(import.meta.dir, "fixtures", "wire-contract-0.3.0.json"), "utf8"));
const { vector } = contract.handshake;

const previousDir = process.env.PAPERBOARD_DIR;
afterEach(() => {
    process.env.PAPERBOARD_DIR = previousDir;
});

// the local client finds its daemon through this data dir's crane.json
function pointClientAt(port: number, token: string): void {
    const dataDir = tempDataDir("wire-client");
    fs.writeFileSync(path.join(dataDir, "local", "crane.json"), JSON.stringify({ port, token }));
    process.env.PAPERBOARD_DIR = dataDir;
}

// A daemon of the previous release, as its wire contract describes it: the
// identity proof, then exactly the recorded answers to the calls the app
// makes. Every frame that strays from the contract is recorded.
async function previousReleaseDaemon(): Promise<{ port: number; violations: string[]; calls: string[]; close(): void }> {
    const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const violations: string[] = [];
    const calls: string[] = [];
    server.on("connection", (ws: WebSocket, req) => {
        const challenge = req.headers[contract.handshake.challengeHeader];
        if (typeof challenge !== "string" || !/^[a-f0-9]{64}$/.test(challenge)) {
            violations.push(`no ${contract.handshake.challengeHeader} challenge`);
        } else {
            const proof = crypto.createHmac("sha256", vector.token)
                .update(contract.handshake.proofMessage.replace("<challenge>", challenge)).digest("hex");
            ws.send(JSON.stringify({ type: contract.handshake.proofFrameType, proof }));
        }
        ws.on("message", (raw) => {
            const frame = JSON.parse(raw.toString());
            const call = contract.calls[frame.action];
            calls.push(frame.action);
            const keys = Object.keys(frame).sort();
            if (JSON.stringify(keys) !== JSON.stringify(contract.request.fields)) violations.push(`${frame.action}: frame fields ${keys}`);
            if (!call) {
                violations.push(`${frame.action} is not a call the previous release answers`);
                ws.send(JSON.stringify({ type: "response", id: frame.id, result: null, error: `Unknown action: ${frame.action}`, code: "NOT_FOUND" }));
                return;
            }
            const params = Object.keys(frame.params ?? {}).filter((k) => frame.params[k] !== undefined).sort();
            if (JSON.stringify(params) !== JSON.stringify(call.params)) violations.push(`${frame.action}: params ${params}, contract ${call.params}`);
            if (frame.params?.v !== contract.protocolVersion) violations.push(`${frame.action}: protocol ${frame.params?.v}`);
            if (frame.params?.token !== vector.token) violations.push(`${frame.action}: not the handshake's token`);
            ws.send(JSON.stringify({ type: "response", id: frame.id, result: call.result }));
        });
    });
    return {
        port: (server.address() as { port: number }).port,
        violations,
        calls,
        close: () => {
            for (const client of server.clients) client.terminate();
            server.close();
        },
    };
}

let otherProtocol: BuiltCrane;
beforeAll(async () => {
    otherProtocol = await compileCrane({ protocolVersion: PROTOCOL_VERSION + 1 });
}, BUILD_TIMEOUT_MS);

// A new app can always reach and update a daemon from the previous release.
describe("talking to the previous release's daemon", () => {
    test("the wire protocol and identity proof are still the previous release's", () => {
        // a bump fails here until the app has a path to the old daemon
        expect(PROTOCOL_VERSION).toBe(contract.protocolVersion);
        expect(DAEMON_CHALLENGE_HEADER).toBe(contract.handshake.challengeHeader);
        expect(DAEMON_PROOF_TYPE).toBe(contract.handshake.proofFrameType);
        expect(daemonProof(vector.token, vector.challenge)).toBe(vector.proof);
    });

    test("the app's client completes the handshake, reads system:info and drives system:update as the previous release expects", async () => {
        const daemon = await previousReleaseDaemon();
        pointClientAt(daemon.port, vector.token);
        const client = new PaperCraneClient();
        const status = await client.connect("127.0.0.1");
        expect(status).toMatchObject({ connected: true, isRemote: false, port: daemon.port });
        expect(client.getLocalCredentials()).toEqual({ port: daemon.port, token: vector.token });
        expect(await client.getSystemInfo()).toEqual(contract.calls["system:info"].result);
        await client.updateCrane("0.3.1", "https://i.paperboard.dev/crane/0.3.1/papercrane-linux-x64.tar.gz", "a".repeat(64), "c2lnbmF0dXJl");
        client.disconnect();
        daemon.close();
        expect(daemon.calls).toEqual(["auth:verify", "system:info", "system:update"]);
        expect(daemon.violations).toEqual([]);
    }, WAIT_MS);

    test("a daemon on another protocol version answers a typed BAD_PROTOCOL error, and the app reports it instead of a reply", async () => {
        const daemon = await startCrane(otherProtocol.file, tempDataDir("wire-other"));
        const socket = await CraneSocket.open(daemon.handshake.port);
        const reply = await socket.send("system:info", { token: daemon.handshake.token, v: PROTOCOL_VERSION });
        const message = contract.badProtocol.error
            .replace("<daemon>", String(PROTOCOL_VERSION + 1))
            .replace("<client>", String(PROTOCOL_VERSION));
        expect(reply).toEqual({ type: "response", id: 1, result: null, error: message, code: contract.badProtocol.code });
        socket.close();

        pointClientAt(daemon.handshake.port, daemon.handshake.token);
        const client = new PaperCraneClient();
        const refused = await client.connect("127.0.0.1").then(
            () => { throw new Error("connected to a daemon on another protocol"); },
            (err: Error) => err,
        );
        expect(refused.message).toContain(message);
        expect(client.getStatus()).toMatchObject({ connected: false });
        expect(client.getStatus().error).toContain(message);
        client.disconnect();
        await daemon.stop();
    }, WAIT_MS);
});
