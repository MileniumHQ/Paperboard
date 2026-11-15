import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { backupApi, type BackupProgressChange } from "../src/backups";
import { terminalApi } from "../src/index";
import { closeTransport, getTransport, initPaperApi } from "../src/ipc";
import { processApi } from "../src/process";
import { secretsApi } from "../src/secrets";
import { startWireServer, type WireServer } from "./helpers/wire";

let server: WireServer;

beforeEach(async () => {
    server = await startWireServer();
    await initPaperApi({ port: server.port, token: server.token });
});

afterEach(async () => {
    closeTransport();
    await server.close();
});

// what the console said while `run` ran
async function consoleErrors(run: () => Promise<void>): Promise<string[]> {
    const lines: string[] = [];
    const consoleError = console.error;
    console.error = (...args: unknown[]) => void lines.push(args.map(String).join(" "));
    try {
        await run();
    } finally {
        console.error = consoleError;
    }
    return lines;
}

// PaperAPI talks to a Paperboard Server of another release on the same
// protocol version: it reads an answer or an event for what its caller
// reads, so fields a newer server adds pass, what an older one leaves out
// is fine unless it is read, and one that doesn't fit is said, never
// handed on as something it isn't.
describe("a Paperboard Server of another release", () => {
    test("events in an older and a newer server's shapes are heard; one that doesn't fit is said and not heard", async () => {
        server.answer = (action) => {
            if (action.endsWith(":attach")) return { success: true };
            return action === "term:exists" ? { running: true } : {};
        };
        const data: string[] = [];
        const terminalExits: (number | undefined)[] = [];
        const stdout: string[] = [];
        const processExits: (number | undefined)[] = [];
        const changes: BackupProgressChange[] = [];
        terminalApi.onData("t1", (text) => data.push(text));
        terminalApi.onExit("t1", (code) => terminalExits.push(code));
        processApi.onStdout("p1", (text) => stdout.push(text));
        processApi.onExit("p1", (code) => processExits.push(code));
        backupApi.onProgress("dev.a", (change) => changes.push(change));
        await getTransport().subscriptionsSettled();

        const said = await consoleErrors(async () => {
            // as every release has sent them
            server.emit("term:data", { id: "t1", data: "old" });
            server.emit("process:data", { id: "p1", data: "out", stream: "stdout" });
            // a program a signal ended has no code
            server.emit("term:exit", { id: "t1", exitCode: null });
            server.emit("process:exit", { id: "p1", exitCode: 3 });
            server.emit("backup:progress", { panelId: "dev.a", sourceId: null, progress: null });
            // what doesn't fit: text that is a number, a list with no panel
            server.emit("term:data", { id: "t1", data: 42 });
            server.emit("backup:progress", { sourceId: null, progress: null });
            // fields a newer release adds, and an optional one it leaves out
            server.emit("term:data", { id: "t1", data: "new", seq: 7 });
            server.emit("process:data", { id: "p1", data: "more", stream: "stdout", at: 12 });
            server.emit("backup:progress", { panelId: "dev.a", progress: null, startedAt: "2026-11-15T00:00:00.000Z" });
            // answered after every event above: the socket keeps their order
            expect(await terminalApi.exists("t1")).toBe(true);
        });

        expect(data).toEqual(["old", "new"]);
        expect(terminalExits).toEqual([undefined]);
        expect(stdout).toEqual(["out", "more"]);
        expect(processExits).toEqual([3]);
        expect(changes).toEqual([
            { panelId: "dev.a", sourceId: null, progress: null },
            { panelId: "dev.a", sourceId: null, progress: null },
        ]);
        expect(said.filter((line) => line.includes("term:data event doesn't fit"))).toHaveLength(1);
        expect(said.filter((line) => line.includes("backup:progress event doesn't fit"))).toHaveLength(1);
    });

    test("an answer is read for what its caller reads: added fields pass, an acknowledgment may say nothing, and one without what is read is refused", async () => {
        server.answer = (action) => {
            // a newer server's extra field, and a count an older one gave as text
            if (action === "secrets:list") return { keys: ["api-key"], cursor: "next" };
            if (action === "secrets:purge") return { purged: "2" };
            return {};
        };
        expect(await secretsApi.list("dev.a")).toEqual(["api-key"]);
        expect(await secretsApi.purge("dev.a")).toBe(2);
        // nobody reads past an acknowledgment's arrival
        await terminalApi.write("t1", "ls\n");
        await processApi.kill("p1");

        server.answer = () => ({});
        await expect(secretsApi.list("dev.a")).rejects.toThrow(`Paperboard Server's answer to secrets:list doesn't fit: the field "keys" is missing`);
        await expect(terminalApi.exists("t1")).rejects.toThrow(`Paperboard Server's answer to term:exists doesn't fit: the field "running" is missing`);
    });
});
