// Game Server installed in the test daemon's data dir the way an install
// leaves it (panels/<id>/manifest.json and the built dist/service.js), so the
// daemon runs the panel's real service itself, restarts it, and backs it up.
// Its state is watched through the panel bridge, as the panel's page does.
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { createPanelBridge, invoke } from "@mileniumhq/paperapi";
import { PANEL_ID } from "../../src/servers";
import type { ServersState } from "../../src/service";
import type { GameServerState } from "../../src/service/types";

const PANEL = path.resolve(import.meta.dir, "../..");

/** builds the service as `bun run build` does and installs the panel into `dataDir`; call before the daemon starts */
export function installPanel(dataDir = process.env.PAPERBOARD_DIR!): void {
    const target = path.join(dataDir, "panels", PANEL_ID);
    fs.mkdirSync(path.join(target, "dist"), { recursive: true });
    fs.copyFileSync(path.join(PANEL, "manifest.json"), path.join(target, "manifest.json"));
    const build = spawnSync(process.execPath, ["build", "./src/service.ts", "--outfile", path.join(target, "dist", "service.js"), "--target=node", "--external", "@mileniumhq/paperui"], { cwd: PANEL, encoding: "utf8" });
    if (build.status !== 0) throw new Error(`Building the panel service failed (exit ${build.status}):\n${build.stdout}\n${build.stderr}`);
}

/** restarts the panel's service through the daemon; resolves once the new one is ready */
export async function restartService(): Promise<void> {
    if (!(await invoke<boolean>("panel-restart-service", PANEL_ID))) throw new Error("The daemon has no Game Server service to restart");
}

export type ServerView = GameServerState;

/** the service's published state, read and watched as its page does */
export function servicesState() {
    const bridge = createPanelBridge<ServersState>({ panelId: PANEL_ID });
    const server = (state: ServersState, id: string) => (state as Record<string, unknown>)[`server:${id}`] as ServerView | undefined;
    return {
        server: async (id: string) => server(await bridge.refreshState(), id),
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
                    void bridge.refreshState().then(
                        (state) => finish(new Error(`Timed out waiting for ${what}; the server shows:\n${JSON.stringify(server(state, id))?.slice(0, 3000)}`)),
                        (err) => finish(new Error(`Timed out waiting for ${what}, and the state could not be read: ${err}`)),
                    );
                }, timeoutMs);
                const check = (state: ServersState) => {
                    const s = server(state, id);
                    if (s && ready(s)) finish(null, s);
                };
                const off = bridge.onStateChange((_patch, full) => check(full));
                bridge.refreshState().then(check, (err) => finish(err instanceof Error ? err : new Error(String(err))));
            }),
    };
}

/** resolves once `file` exists and its text satisfies `ready`, checked on every change in its folder */
export function waitForFile(file: string, ready: (text: string) => boolean, what: string, timeoutMs = 20_000): Promise<string> {
    return new Promise((resolve, reject) => {
        const dir = path.dirname(file);
        fs.mkdirSync(dir, { recursive: true });
        const read = () => (fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null);
        const check = () => {
            const text = read();
            if (text === null || !ready(text)) return false;
            watcher.close();
            clearTimeout(timer);
            resolve(text);
            return true;
        };
        const watcher = fs.watch(dir, () => void check());
        const timer = setTimeout(() => {
            watcher.close();
            reject(new Error(`Timed out waiting for ${what}; ${file} holds: ${read()?.slice(0, 2000)}`));
        }, timeoutMs);
        check();
    });
}
