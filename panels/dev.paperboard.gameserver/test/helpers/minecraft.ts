// A Minecraft server on the test daemon: its folder in the daemon's files
// area, the stand-in java (fakeJava.ts) installed as its runtime, and its
// process output wired into the panel's lifecycle the way service.ts does
// it on initialize.
import * as fs from "node:fs";
import * as path from "node:path";
import { handleProcessData, handleProcessExit } from "../../src/service/lifecycle";
import { inServer } from "../../src/service/scope";
import { processApi } from "../../src/service/api";
import { javaPackageFor } from "../../src/lib/versionProfile";
import { PANEL_ID } from "../../src/servers";
import type { GameServerState } from "../../src/service/types";
import { installFakeJava } from "./fakeJava";
import { testScope, type TestScope } from "./scope";
import { writeTree } from "./tmp";
import { onDaemonStop } from "./crane";

// a test that failed midway may leave its server running: it is ended here,
// through the daemon, before the daemon stops, so no workload outlives the file
const created: McServer[] = [];
onDaemonStop(async () => {
    for (const mc of created.splice(0)) {
        for (const id of mc.scope.processIds) {
            if (!(await mc.run(() => processApi.exists(id)))) continue;
            const exit = id === "mc-server" ? mc.nextExit() : null;
            await mc.run(() => processApi.kill(id, "SIGKILL"));
            if (exit) await exit;
        }
    }
});

let counter = 0;

export interface McServer {
    scope: TestScope;
    /** the server folder on disk */
    dir: string;
    run<T>(work: () => T): T;
    /** resolves with the exit code of the next exit of the server process */
    nextExit(): Promise<number | undefined>;
    /** the console commands the server process received, in order */
    commands(): string[];
    /** resolves once the server process has received `command` (counting from `after` received ones) */
    received(command: string, after?: number): Promise<void>;
}

export function minecraftServer(opts: {
    version?: string;
    software?: string;
    settings?: Record<string, unknown>;
    files?: Record<string, string>;
    state?: Partial<GameServerState>;
} = {}): McServer {
    const version = opts.version ?? "1.21.1";
    const software = opts.software ?? "vanilla";
    const id = `mc${++counter}${Date.now().toString(36)}`;
    const directory = `servers/${id}`;
    const dir = path.join(process.env.PAPERBOARD_DIR!, "files", PANEL_ID, ...directory.split("/"));
    fs.mkdirSync(dir, { recursive: true });
    writeTree(dir, { "server.jar": "jar", "eula.txt": "eula=true\n", ...opts.files });
    const pkg = javaPackageFor(version);
    if (!pkg) throw new Error(`No Java package for ${version}`);
    installFakeJava(pkg);
    const scope = testScope(
        { id, directory, settings: { configured: true, software, version, ...opts.settings } },
        { serverSoftware: software as GameServerState["serverSoftware"], serverVersion: version, ramAllocation: 1, ...opts.state },
    );
    const run = <T>(work: () => T): T => inServer(scope, work);
    const exits: ((code: number | undefined) => void)[] = [];
    run(() => {
        scope.unsubscribe.push(processApi.onData("mc-server", (chunk) => handleProcessData(scope.ctx, chunk)));
        scope.unsubscribe.push(
            processApi.onExit("mc-server", (code) => {
                handleProcessExit(scope.ctx, code);
                for (const waiter of exits.splice(0)) waiter(code);
            }),
        );
    });
    const commands = () => {
        const file = path.join(dir, "commands.log");
        return fs.existsSync(file) ? fs.readFileSync(file, "utf8").split("\n").filter(Boolean) : [];
    };
    const server: McServer = {
        scope,
        dir,
        run,
        nextExit: () => new Promise((resolve) => exits.push(resolve)),
        commands,
        received: async (command, after = 0) => {
            const line = `[fake] received: ${command}`;
            await scope.waitFor(
                (s) => s.serverEntries.filter((e) => e.content === line).length > after,
                `the server to receive ${JSON.stringify(command)}`,
            );
        },
    };
    created.push(server);
    return server;
}
