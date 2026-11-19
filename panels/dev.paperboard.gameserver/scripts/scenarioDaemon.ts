/**
 * A real Paperboard daemon for an operator smoke script: the compiled crane
 * with its workload supervisor and the panel's built service, started on a
 * disposable PAPERBOARD_DIR outside the checkout, as the test suite starts
 * one, but with the network left open so it can download the real game.
 * Whatever the work started is stopped and the folder removed afterwards,
 * whether it passed or threw.
 *
 * On a computer without the checkout (the Windows VM), SMOKE_CRANE names a
 * daemon compiled elsewhere and SMOKE_PANEL a panel folder built elsewhere
 * (manifest.json and dist/); the script itself is bundled with
 * `bun build --target=bun` and run by a bare bun.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ServiceCalls } from "@mileniumhq/paperapi";
import type { GameServerState } from "../src/service/types";
import type { gameServerContract } from "../src/service/contract";

export const PANEL = "dev.paperboard.gameserver";
const REPO = path.resolve(import.meta.dir, "../../..");

export async function until(check: () => boolean | Promise<boolean>, label: string, timeout = 15_000) {
    const deadline = Date.now() + timeout;
    while (!(await check())) { if (Date.now() >= deadline) throw new Error(`Timed out: ${label}`); await Bun.sleep(100); }
}
export function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }

export interface ScenarioServer {
    id: string;
    /** the server's folder on disk */
    directory: string;
    /** its calls, as its page makes them */
    calls: ServiceCalls<typeof gameServerContract>;
    state(): Promise<GameServerState>;
    /** the console's lines, as text */
    console(): Promise<string[]>;
}
export interface Scenario {
    root: string;
    /** adds a server of a game; `processId` is its game's primary process, killed if the scenario ends with it running */
    addServer(name: string, game: string, processId: string): Promise<ScenarioServer>;
}

export async function withScenarioDaemon(prefix: string, work: (scenario: Scenario) => Promise<void>): Promise<void> {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
    process.env.PAPERBOARD_DIR = root;
    let binary = process.env.SMOKE_CRANE;
    if (!binary) {
        const { buildSupervisor } = await import("../../../scripts/build/supervisor");
        binary = path.join(root, "bin", process.platform === "win32" ? "papercrane.exe" : "papercrane");
        const build = spawnSync(process.execPath, ["build", "--compile", path.join(REPO, "apps/daemon/src/main.ts"), buildSupervisor(), "--outfile", binary], { cwd: path.join(REPO, "apps/paperboard"), encoding: "utf8" });
        if (build.status !== 0 || !fs.existsSync(binary)) throw new Error(`Building the crane daemon failed (exit ${build.status}):\n${build.stdout}\n${build.stderr}`);
    }
    if (process.env.SMOKE_PANEL) fs.cpSync(process.env.SMOKE_PANEL, path.join(root, "panels", PANEL), { recursive: true });
    else (await import("../test/helpers/installedPanel")).installPanel(root);
    const env = { ...process.env, PAPERBOARD_DIR: root };
    delete env.ELECTRON_RUN_AS_NODE;
    const daemon = spawn(binary, ["--data-dir", root, "--port", "0", "--host", "127.0.0.1", "--headless"], { env, stdio: ["ignore", "pipe", "pipe"] });
    let log = "";
    const exited = new Promise<void>((resolve) => daemon.once("exit", () => resolve()));
    daemon.stdout.on("data", (chunk: Buffer) => { log += chunk.toString("utf8"); });
    daemon.stderr.on("data", (chunk: Buffer) => { log += chunk.toString("utf8"); });
    // paperapi finds the daemon through PAPERBOARD_DIR, so it loads once that is set
    const api = await import("@mileniumhq/paperapi");
    const { gameServerContract } = await import("../src/service/contract");
    const processes: string[] = [];
    const servers: ScenarioServer[] = [];
    try {
        await until(() => { if (daemon.exitCode !== null) throw new Error(`The daemon exited before it listened:\n${log}`); return /Listening on https?:\/\/127\.0\.0\.1:\d+/.test(log); }, "the daemon to listen", 30_000);
        const panel = api.serviceClient(gameServerContract);
        // quiet: polled until the service answers; a failure here is it still starting
        await until(async () => Array.isArray((await panel.state.refresh().catch(() => null))?.servers), "the panel's service", 60_000);
        await work({
            root,
            async addServer(name, game, processId) {
                const { id } = await panel.calls.addServer({ name, game });
                const stored = (await api.config.get<any>(PANEL)).servers.find((s: any) => s.id === id);
                processes.push(`${id}-${processId}`);
                const state = async () => {
                    const value = await panel.keyed.server.read(id);
                    if (!value) throw new Error("The server's state has not loaded");
                    return value;
                };
                const server: ScenarioServer = {
                    id, directory: await api.fileApi.getPath(stored.directory, PANEL), state,
                    calls: api.serviceClient(gameServerContract, { server: id }).calls,
                    console: async () => (await state()).serverEntries.map((e) => String(e.content)),
                };
                servers.push(server);
                return server;
            },
        });
    } catch (err) {
        for (const server of servers) console.error(`Failure console of ${server.id}:\n${await server.console().then((lines) => lines.slice(-60).join("\n"), (e) => `unreadable: ${e}`)}`);
        console.error(`Daemon output:\n${log.split("\n").slice(-30).join("\n")}`);
        throw err;
    } finally {
        // workloads run under supervisors that outlive the daemon by design: end them through it first
        // quiet: cleanup after the scenario; its own outcome is already thrown or returned
        for (const id of processes) if (await api.processApi.exists(id).catch(() => false)) await api.processApi.kill(id, "SIGKILL").catch((err) => console.error(`Could not end ${id}: ${err}`));
        // the wire would otherwise keep trying to reach a daemon that is gone
        api.closeTransport("local");
        daemon.kill();
        await exited;
        // SMOKE_KEEP leaves the folder for a look at what a failed run wrote
        if (process.env.SMOKE_KEEP) console.error(`Kept ${root}`);
        else fs.rmSync(root, { recursive: true, force: true });
    }
}
