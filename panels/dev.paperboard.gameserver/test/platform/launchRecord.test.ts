import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { startTestDaemon, type TestDaemon } from "../helpers/crane";
import { minecraftServer, type McServer } from "../helpers/minecraft";
import { tempDir, writeTree } from "../helpers/tmp";
import { javaLaunchArgs, parseLaunchSpec } from "../../src/software/launch";
import { parseInstallRecord } from "../../src/software/installRecord";
import { heapFit, oomKillCount } from "../../src/service/memory";
import { afterCrash } from "../../src/service/automation";
import { startServerInstance, stopServerInstance } from "../../src/service/lifecycle";
import { panelActions } from "../../src/games/minecraft/actions";
import { ACTION_IDS } from "../../src/service/contract";
import { testScope } from "../helpers/scope";
import { inServer } from "../../src/service/scope";

let daemon: TestDaemon;
beforeAll(async () => {
    daemon = await startTestDaemon();
});
afterAll(async () => {
    await daemon?.stop();
});

const NEO = "libraries/net/neoforged/neoforge/21.1.256";
const record = (launch: unknown, files: string[] = ["libraries"]) => ({
    software: "neoforge",
    version: "1.21.1",
    build: "21.1.256",
    launch,
    files,
    staging: ".install-1-1",
});
const argv = (mc: McServer): string[] => JSON.parse(fs.readFileSync(path.join(mc.dir, "argv.json"), "utf8"));

async function launchOnce(mc: McServer): Promise<string[]> {
    await mc.run(() => startServerInstance(mc.scope.ctx));
    await mc.scope.waitFor((s) => s.serverStatus === "online", "the server to come online");
    const exit = mc.nextExit();
    await mc.run(() => stopServerInstance(mc.scope.ctx));
    await exit;
    return argv(mc);
}

// The launch record is validated, then launched as written.
describe("the launch record", () => {
    test("a jar or argfile path leaving the server folder, or an unknown launch type, is rejected", () => {
        for (const jar of ["../../bin/evil.jar", "/etc/evil.jar", "..\\evil.jar", "C:\\evil.jar", "libs//x.jar", "", "a/../../b.jar"]) {
            expect(parseLaunchSpec({ type: "jar", jar })).toBeNull();
            expect(parseLaunchSpec({ type: "argfile", unix: jar, windows: `${NEO}/win_args.txt` })).toBeNull();
            expect(parseLaunchSpec({ type: "argfile", unix: `${NEO}/unix_args.txt`, windows: jar })).toBeNull();
        }
        expect(parseLaunchSpec({ type: "shell", command: "rm -rf /" })).toBeNull();
        expect(parseLaunchSpec({ type: "jar", jar: "server.jar" })).toEqual({ type: "jar", jar: "server.jar" });
    });

    test("a record that owns user data or carries a forged launch is unreadable", () => {
        for (const files of [["world"], ["server.properties"], ["plugins"], ["libraries", "../outside"]]) {
            expect(() => parseInstallRecord(record({ type: "jar", jar: "server.jar" }, files))).toThrow("The recorded server install is unreadable");
        }
        expect(() => parseInstallRecord(record({ type: "jar", jar: "../../bin/evil.jar" }))).toThrow("unreadable");
        expect(parseInstallRecord(record({ type: "argfile", unix: `${NEO}/unix_args.txt`, windows: `${NEO}/win_args.txt` }))?.software).toBe("neoforge");
    });

    test("the generic config patch cannot set what an install records", async () => {
        const action = panelActions.find((a) => a.id === ACTION_IDS.updatePanelConfig)!;
        const scope = testScope({ directory: "servers/patch" });
        for (const key of ["software", "version", "install"]) {
            await expect(inServer(scope, () => (action.run as Function)(scope.ctx, { patch: { [key]: "forge" } }))).rejects.toThrow(
                `"${key}" is set by installing a server version`,
            );
        }
    });

    test("modern NeoForge launches through this OS's argument file, with the heap in whole megabytes", async () => {
        const mc = minecraftServer({
            software: "neoforge",
            settings: { install: record({ type: "argfile", unix: `${NEO}/unix_args.txt`, windows: `${NEO}/win_args.txt` }) },
            state: { ramAllocation: 1.5 },
            files: { [`${NEO}/unix_args.txt`]: "-p a.jar", [`${NEO}/win_args.txt`]: "-p a.jar" },
        });
        const args = await launchOnce(mc);
        expect(args.slice(0, 2)).toEqual(["-Xmx1536M", "-Xms1536M"]);
        expect(args.slice(-2)).toEqual([`@${NEO}/${process.platform === "win32" ? "win_args.txt" : "unix_args.txt"}`, "nogui"]);
        expect(args).not.toContain("-jar");
    });

    test("legacy Forge launches its jar", async () => {
        const jar = "forge-1.12.2-14.23.5.2859.jar";
        const mc = minecraftServer({
            version: "1.12.2",
            software: "forge",
            settings: { install: { ...record({ type: "jar", jar }, [jar]), software: "forge", version: "1.12.2", build: "14.23.5.2859" } },
            files: { [jar]: "forge" },
        });
        expect((await launchOnce(mc)).slice(-3)).toEqual(["-jar", jar, "nogui"]);
    });

    test("a missing entry file launches nothing and says so", async () => {
        const mc = minecraftServer({
            software: "neoforge",
            settings: { install: record({ type: "argfile", unix: `${NEO}/unix_args.txt`, windows: `${NEO}/win_args.txt` }) },
        });
        await mc.run(() => startServerInstance(mc.scope.ctx));
        expect(mc.scope.ctx.state.serverStatus).toBe("offline");
        expect(mc.scope.ctx.state.serverEntries.at(-1)?.content).toMatch(/args\.txt is missing in the server folder/);
        expect(fs.existsSync(path.join(mc.dir, "argv.json"))).toBe(false);
    });

    test("a heap that cannot fit the machine is refused before Java starts", async () => {
        const total = os.totalmem() / 1024 ** 3;
        const mc = minecraftServer({ state: { ramAllocation: Math.ceil(total) + 1 } });
        await mc.run(() => startServerInstance(mc.scope.ctx));
        expect(mc.scope.ctx.state.serverStatus).toBe("offline");
        expect(mc.scope.ctx.state.serverEntries.at(-1)?.content).toContain("Lower Memory Allocation in Options to");
        expect(fs.existsSync(path.join(mc.dir, "argv.json"))).toBe(false);
        // just below the machine: starts, with a warning
        expect(heapFit(4, 4.9 * 1024 ** 3)).toEqual({ warn: expect.stringContaining("may end the server when memory runs out") });
        expect(heapFit(2, 8 * 1024 ** 3)).toBeNull();
        expect(javaLaunchArgs({ type: "jar", jar: "server.jar" }, { ramGb: 0.3, javaMajor: 21, hugePages: false }, false).slice(0, 2)).toEqual([
            "-Xmx307M",
            "-Xms307M",
        ]);
    });

    test("an exit-137 kill counted by the system as out of memory is named as such", () => {
        const scope = testScope({ directory: "servers/oom" });
        inServer(scope, () => afterCrash(scope.ctx, { whileStarting: false, exitCode: 137, outOfMemory: true }, async () => undefined));
        expect(scope.ctx.state.serverEntries[0]?.content).toBe(
            "[Server] The computer ran out of memory, so the system ended the server (exit code 137). Give the server less memory or close other programs.",
        );
        if (process.platform === "linux") {
            // cgroup v2: the service's group and its memory.events
            const root = tempDir();
            writeTree(root, { "proc-self-cgroup": "0::/user.slice/paperboard.service\n", "user.slice/paperboard.service/memory.events": "low 0\nhigh 0\nmax 0\noom 1\noom_kill 3\n" });
            expect(oomKillCount(root, path.join(root, "proc-self-cgroup"))).toBe(3);
            writeTree(root, { "user.slice/paperboard.service/memory.events": "low 0\n" });
            expect(() => oomKillCount(root, path.join(root, "proc-self-cgroup"))).toThrow("no oom_kill count");
            // no cgroup v2 here: no count rather than a guess
            expect(oomKillCount(path.join(root, "missing"), path.join(root, "proc-self-cgroup"))).toBeNull();
        } else {
            // only Linux keeps a count of programs it ended for memory
            expect(oomKillCount()).toBeNull();
        }
    });
});
