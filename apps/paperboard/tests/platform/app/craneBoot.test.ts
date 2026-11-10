import { beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { verifyDaemonProof, DAEMON_CHALLENGE_HEADER, DAEMON_PROOF_TYPE } from "../../../papercrane/handshake";
import { APP_PACKAGE, BUILD_TIMEOUT_MS, buildCrane, type BuiltCrane } from "./support/build";
import { CraneSocket, randomChallenge, startCrane, WAIT_MS } from "./support/crane";
import { tempDir } from "./support/temp";

const OS_NAME: Record<string, string> = { linux: "linux", darwin: "macos", win32: "windows" };

let crane: BuiltCrane;
beforeAll(async () => {
    crane = await buildCrane();
}, BUILD_TIMEOUT_MS);

// The compiled daemon boots, serves and stops on every target.
describe("compiled daemon", () => {
    test("boots headless on an empty data dir, proves itself, answers only authenticated calls and stops cleanly", async () => {
        const dataDir = tempDir("crane-boot");
        const daemon = await startCrane(crane.file, dataDir);
        const { port, token, pid } = daemon.handshake;
        expect(pid).toBe(daemon.child.pid!);
        expect(port).toBeGreaterThan(0);
        expect(token.length).toBeGreaterThan(16);

        // the identity proof local clients check before sending a credential
        const challenge = randomChallenge();
        const probe = await CraneSocket.open(port, { [DAEMON_CHALLENGE_HEADER]: challenge });
        const proof = await probe.waitFrame("daemon proof", (f) => f.type === DAEMON_PROOF_TYPE);
        expect(verifyDaemonProof(token, challenge, proof.proof)).toBe(true);

        // no credential, no answer
        const refused = await probe.send("system:info");
        expect(refused.result).toBeNull();
        expect(refused.code).toBe("AUTH_REQUIRED");
        const wrong = await probe.send("auth:verify", { token: "pc_not-the-token" });
        expect(wrong.code).toBe("AUTH_REQUIRED");
        probe.close();

        const socket = await CraneSocket.authed(port, token);
        const info = await socket.call("system:info");
        expect(info.service).toBe("papercrane");
        expect(info.version).toBe(APP_PACKAGE.version);
        expect(info.os).toBe(OS_NAME[process.platform]);
        expect(info.arch).toBe(process.arch);
        socket.close();

        const exit = await daemon.stop();
        if (process.platform === "win32") {
            // TerminateProcess ends it where it stands: no handler runs
            expect(exit.code).not.toBeNull();
        } else {
            // SIGTERM runs the daemon's own shutdown: exit 0, handshake gone
            expect(exit).toEqual({ code: 0, signal: null });
            expect(fs.existsSync(path.join(dataDir, "local", "crane.json"))).toBe(false);
        }

        // what it left behind is readable, and the next daemon starts on it
        for (const file of fs.readdirSync(path.join(dataDir, "local"))) {
            if (file.endsWith(".json")) expect(() => JSON.parse(fs.readFileSync(path.join(dataDir, "local", file), "utf8"))).not.toThrow();
        }
        const again = await startCrane(crane.file, dataDir);
        const second = await CraneSocket.authed(again.handshake.port, again.handshake.token);
        expect((await second.call("system:info")).version).toBe(APP_PACKAGE.version);
        second.close();
        await again.stop();
    }, WAIT_MS * 3);
});
