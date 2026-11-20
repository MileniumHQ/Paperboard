import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startTestDaemon, type TestDaemon } from "../helpers/crane";
import { cs2Server } from "../helpers/cs2";
import { startServerInstance } from "../../src/service/lifecycle";
import { gameFor } from "../../src/games";

let daemon: TestDaemon;
beforeAll(async () => {
    daemon = await startTestDaemon();
});
afterAll(async () => {
    await daemon?.stop();
});

// whether this computer runs the dedicated server, by the game's own rule
// (Paperboard runs the Linux build, on x64 only)
const support = gameFor("counter-strike-2").hostSupport({ os: process.platform, arch: process.arch }, { software: "", version: "" });

// Counter-Strike 2 running, against a stand-in that prints what the real server was measured to (build 26598758).
describe("Counter-Strike 2", () => {
    test.skipIf(support.supported)("a computer it doesn't run on is told why at Start, and the server stays offline", async () => {
        const server = await cs2Server();
        await expect(startServerInstance(server.server)).rejects.toThrow(support.reason!);
        expect(server.server.state.serverStatus).toBe("offline");
    });
});
