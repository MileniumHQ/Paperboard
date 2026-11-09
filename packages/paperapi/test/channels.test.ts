import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { backupApi, backupLocationsApi } from "../src/backups";
import { closeTransport, initPaperApi } from "../src/ipc";
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

// what each daemon action answers, in the daemon's own shapes
const ANSWERS: Record<string, unknown> = {
    "secrets:set": { success: true },
    "secrets:get": { found: true, value: "s3cret" },
    "secrets:delete": { deleted: true },
    "secrets:list": { keys: ["api-key", "refresh"] },
    "secrets:purge": { purged: 2 },
    "backup:status": { destination: null, running: null, progress: null, schedule: null },
    "backup:progress": { progress: [] },
    "backup:list": { backups: [] },
    "backup:destinations": { destinations: [] },
    "backup:destinations-problem": { problem: "locations.json is not valid JSON" },
    "backup:destinations-recover": { keptAs: "locations.json.broken" },
};

// Secrets and backup channels reach the right daemon actions with the documented shapes.
describe("secrets and backup channels reach the right daemon actions with the documented shapes", () => {
    test("every secrets channel maps to secrets:* and resolves the documented shape", async () => {
        server.answer = (action) => ANSWERS[action] ?? {};
        expect(await secretsApi.set("api-key", "v", "dev.a")).toBe(true);
        expect(await secretsApi.get("api-key", "dev.a")).toEqual({ found: true, value: "s3cret" });
        expect(await secretsApi.delete("api-key", "dev.a")).toBe(true);
        expect(await secretsApi.list("dev.a")).toEqual(["api-key", "refresh"]);
        expect(await secretsApi.purge("dev.a")).toBe(2);
        const sent = server.frames.filter((f) => f.msg?.action?.startsWith("secrets:")).map((f) => [f.msg.action, f.msg.params.panelId]);
        expect(sent).toEqual([
            ["secrets:set", "dev.a"],
            ["secrets:get", "dev.a"],
            ["secrets:delete", "dev.a"],
            ["secrets:list", "dev.a"],
            ["secrets:purge", "dev.a"],
        ]);
        server.answer = (action) => (action === "secrets:get" ? { found: false } : {});
        expect(await secretsApi.get("missing", "dev.a")).toEqual({ found: false, value: null });
        expect(() => secretsApi.list("")).toThrow("requires a non-empty string panelId");
    });

    test("every backup channel maps to its backup:* action", async () => {
        server.answer = (action) => ANSWERS[action] ?? {};
        const source = backupApi.forSource("dev.a", "world");
        const calls: [string, () => Promise<unknown>][] = [
            ["backup:source-define", () => backupApi.defineSource("dev.a", { id: "world", directory: "world", config: [], processes: [] })],
            ["backup:status", () => backupApi.status("dev.a")],
            ["backup:progress", () => backupApi.progress("dev.a")],
            ["backup:create", () => backupApi.create("dev.a", { label: "Before update" })],
            ["backup:list", () => backupApi.list("dev.a")],
            ["backup:restore", () => backupApi.restore("dev.a", "b1")],
            ["backup:delete", () => backupApi.delete("dev.a", "b1")],
            ["backup:schedule-set", () => backupApi.setSchedule("dev.a", { everyHours: 24, keep: 7 })],
            ["backup:status", () => source.status()],
            ["backup:create", () => source.create()],
            ["backup:destinations", () => backupLocationsApi.list()],
            ["backup:destinations-problem", () => backupLocationsApi.problem()],
            ["backup:destinations-recover", () => backupLocationsApi.recover()],
            ["backup:destination-usage", () => backupLocationsApi.usage("loc-1")],
            ["backup:destination-add", () => backupLocationsApi.add({ kind: "s3", label: "B", endpoint: "https://s3.test", region: "r", bucket: "b", accessKeyId: "k", secretAccessKey: "s" })],
            ["backup:destination-remove", () => backupLocationsApi.remove("loc-1")],
            ["backup:panel-destination-set", () => backupLocationsApi.setForPanel("dev.a", "loc-1")],
        ];
        for (const [, run] of calls) await run();
        const sent = server.frames.filter((f) => f.msg?.action?.startsWith("backup:")).map((f) => f.msg.action);
        expect(sent).toEqual(calls.map(([action]) => action));
        const sourced = server.frames.filter((f) => f.msg?.action === "backup:create").map((f) => f.msg.params);
        expect(sourced[1]).toMatchObject({ panelId: "dev.a", sourceId: "world" });
        expect(await backupLocationsApi.problem()).toBe("locations.json is not valid JSON");
        expect(await backupLocationsApi.recover()).toEqual({ keptAs: "locations.json.broken" });
        server.answer = () => ({});
        expect(await backupLocationsApi.problem()).toBeNull();
    });
});
