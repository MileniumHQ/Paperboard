// A server of another game on the test daemon: its folder in the daemon's
// files area and its process output wired into the panel's lifecycle the
// way service.ts does it on initialize.
import * as fs from "node:fs";
import * as path from "node:path";
import { handleProcessData, handleProcessExit } from "../../src/service/lifecycle";
import { inServer } from "../../src/service/scope";
import { processApi } from "../../src/service/api";
import { gameServiceFor } from "../../src/games/service";
import { PANEL_ID } from "../../src/servers";
import type { GameServerState } from "../../src/service/types";
import { testScope, type TestScope } from "./scope";
import { writeTree } from "./tmp";
import { onDaemonStop } from "./crane";

const created: GameServer[] = [];
// a test that failed midway may leave its server running; it ends here, through the daemon
onDaemonStop(async () => {
    for (const server of created.splice(0)) {
        for (const id of server.scope.processIds) {
            if (await server.run(() => processApi.exists(id))) {
                const exit = id === server.primary ? server.nextExit() : null;
                await server.run(() => processApi.kill(id, "SIGKILL"));
                if (exit) await exit;
            }
        }
    }
});

let counter = 0;

export interface GameServer {
    scope: TestScope;
    dir: string;
    primary: string;
    run<T>(work: () => T): T;
    nextExit(): Promise<number | undefined>;
}

export function gameServer(game: string, opts: { settings?: Record<string, unknown>; files?: Record<string, string>; state?: Partial<GameServerState> } = {}): GameServer {
    const id = `${game.slice(0, 4)}${++counter}${Date.now().toString(36)}`;
    const directory = `servers/${id}`;
    const dir = path.join(process.env.PAPERBOARD_DIR!, "files", PANEL_ID, ...directory.split("/"));
    fs.mkdirSync(dir, { recursive: true });
    writeTree(dir, opts.files ?? {});
    const service = gameServiceFor(game);
    const scope = testScope({ id, game, directory, settings: { ...opts.settings } }, opts.state ?? {});
    const run = <T>(work: () => T): T => inServer(scope, work);
    const exits: ((code: number | undefined) => void)[] = [];
    run(() => {
        scope.unsubscribe.push(processApi.onData(service.primaryProcessId, (chunk) => handleProcessData(scope.ctx, chunk)));
        scope.unsubscribe.push(
            processApi.onExit(service.primaryProcessId, (code) => {
                handleProcessExit(scope.ctx, code);
                for (const waiter of exits.splice(0)) waiter(code);
            }),
        );
    });
    const server: GameServer = { scope, dir, primary: service.primaryProcessId, run, nextExit: () => new Promise((resolve) => exits.push(resolve)) };
    created.push(server);
    return server;
}
