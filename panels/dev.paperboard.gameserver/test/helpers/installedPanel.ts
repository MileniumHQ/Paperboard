// Game Server installed in the test daemon's data dir the way an install
// leaves it (panels/<id>/manifest.json and the built dist/service.js with the
// parts it loads later beside it, built as package.json builds them), so the
// daemon runs the panel's real service itself, restarts it, and backs it up.
// Each server's state is read and followed through the panel's contract, as
// its page does.
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { waitFor } from "testkit/wait";
import { invoke, serviceClient } from "@mileniumhq/paperapi";
import { PANEL_ID } from "../../src/servers";
import { gameServerContract } from "../../src/service/contract";
import type { GameServerState } from "../../src/service/types";

const PANEL = path.resolve(import.meta.dir, "../..");

/** builds the service as `bun run build` does and installs the panel into `dataDir`; call before the daemon starts */
export function installPanel(dataDir = process.env.PAPERBOARD_DIR!): void {
    const target = path.join(dataDir, "panels", PANEL_ID);
    fs.mkdirSync(path.join(target, "dist"), { recursive: true });
    fs.copyFileSync(path.join(PANEL, "manifest.json"), path.join(target, "manifest.json"));
    const build = spawnSync(process.execPath, ["build", "./src/service.ts", "--outdir", path.join(target, "dist"), "--entry-naming", "[name].[ext]", "--chunk-naming", "service/[name]-[hash].[ext]", "--splitting", "--target=node", "--external", "@mileniumhq/paperui"], { cwd: PANEL, encoding: "utf8" });
    if (build.status !== 0) throw new Error(`Building the panel service failed (exit ${build.status}):\n${build.stdout}\n${build.stderr}`);
}

/** restarts the panel's service through the daemon; resolves once the new one is ready */
export async function restartService(): Promise<void> {
    if (!(await invoke<boolean>("panel-restart-service", PANEL_ID))) throw new Error("The daemon has no Game Server service to restart");
}

export type ServerView = GameServerState;

/** the service's published state, read and watched as its page does */
export function servicesState() {
    const servers = serviceClient(gameServerContract).keyed.server;
    return {
        server: (id: string) => servers.read(id),
        /** resolves once `ready` holds for server `id`, checked now and on every pushed change */
        waitFor: (id: string, ready: (s: ServerView) => boolean, what: string, timeoutMs = 20_000) =>
            new Promise<ServerView>((resolve, reject) => {
                let done = false;
                const finish = (err: Error | null, s?: ServerView) => {
                    if (done) return;
                    done = true;
                    clearTimeout(timer);
                    off();
                    if (err) reject(err);
                    else resolve(s!);
                };
                const timer = setTimeout(() => {
                    void servers.read(id).then(
                        (state) => finish(new Error(`Timed out waiting for ${what}; the server shows:\n${JSON.stringify(state)?.slice(0, 3000)}`)),
                        (err) => finish(new Error(`Timed out waiting for ${what}, and the state could not be read: ${err}`)),
                    );
                }, timeoutMs);
                const check = (s: ServerView | undefined) => {
                    if (s && ready(s)) finish(null, s);
                };
                const off = servers.follow(id)(check);
                servers.read(id).then(check, (err) => finish(err instanceof Error ? err : new Error(String(err))));
            }),
    };
}

/** resolves once `file` exists and its text satisfies `ready`; read again and again, since a folder's watcher (fs.watch) misses writes under Bun */
export async function waitForFile(file: string, ready: (text: string) => boolean, what: string, timeoutMs = 20_000): Promise<string> {
    let last: string | null = null;
    try {
        return await waitFor(what, () => {
            last = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
            // "" is a file too
            return last !== null && ready(last) ? { text: last } : null;
        }, { timeoutMs }).then((found) => found.text);
    } catch (err) {
        throw new Error(`${(err as Error).message}; ${file} holds: ${(last as string | null)?.slice(0, 2000)}`);
    }
}
