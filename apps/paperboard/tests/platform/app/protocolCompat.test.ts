import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { PROTOCOL_VERSION } from "daemon/core/protocol";
import { DAEMON_CHALLENGE_HEADER, DAEMON_PROOF_TYPE, daemonProof } from "daemon/security/handshake";
import { PaperCraneClient } from "../../../src/main/communication/papercrane/PaperCraneClient";
import { BUILD_TIMEOUT_MS, compileCrane, type BuiltCrane } from "./support/build";
import { CraneSocket, startCrane, WAIT_MS } from "./support/crane";
import { restoreEnv } from "testkit/fs";
import { tempDataDir } from "./support/temp";

// The previous release's wire contract, pinned. A new contract file is
// added when a release changes the wire; this one is never edited.
const contract = JSON.parse(fs.readFileSync(path.join(import.meta.dir, "fixtures", "wire-contract-0.3.0.json"), "utf8"));
const { vector } = contract.handshake;

const previousDir = process.env.PAPERBOARD_DIR;
afterEach(() => {
    restoreEnv("PAPERBOARD_DIR", previousDir);
});

// the local client finds its daemon through this data dir's crane.json
function pointClientAt(port: number, token: string): void {
    const dataDir = tempDataDir("wire-client");
    fs.writeFileSync(path.join(dataDir, "local", "crane.json"), JSON.stringify({ port, token }));
    process.env.PAPERBOARD_DIR = dataDir;
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
