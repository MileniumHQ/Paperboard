// Standalone PaperCrane daemon entrypoint: `bun build --compile
// ./papercrane/main.ts` is the headless binary for remote machines.
//
// Two artifacts, one source tree. The Electron shell embeds the daemon via
// startPaperCraneServer() from ./index and never imports this file; the
// compiled binary starts here. The split is structural (entry module with
// an import.meta.main gate), not the old require.main/argv-sniff heuristic
// in ./index — importing ./index has zero autostart side effects in any
// host, so a GUI import can never shadow the embedded daemon and a test
// import can never boot a server.
import { fileURLToPath, pathToFileURL } from "url";
import { startPaperCraneServer } from "./index";
import { CliHandledExit, CliUsageError, EXIT, parseCli } from "./cli";
import * as fs from "fs";
import * as path from "path";
import { setSupervisorBinary } from "./supervisorBinary";
import { getPaperboardDir } from "./paths";

// clean one-line startup failures instead of raw stacks
function fatalCliError(err: any): never {
    const msg = err?.message || String(err);
    if (err?.code === "EADDRINUSE" && typeof err?.port === "number") {
        // the daemon's own message names the port and the way out
        console.error(`[Paperboard Server] ${msg}`);
    } else if (err?.code === "EADDRINUSE") {
        console.error(`[Paperboard Server] Port is already in use. Another Paperboard Server may be running, or pass --port <n>.`);
    } else if (/EACCES|EPERM|permission/i.test(msg)) {
        console.error(`[Paperboard Server] Cannot start: ${msg}`);
        console.error(`[Paperboard Server] Check the data directory is writable (PAPERBOARD_DIR=${getPaperboardDir()}).`);
    } else {
        console.error(`[Paperboard Server] Failed to start: ${msg}`);
    }
    process.exit(EXIT.FAILURE);
}

// a command that finishes (status, pair, the service commands): its
// failure is the message alone, then exit 1
async function finish(command: () => Promise<number>): Promise<void> {
    let code: number;
    try {
        code = await command();
    } catch (err) {
        console.error((err as Error)?.message || String(err));
        code = EXIT.FAILURE;
    }
    process.exit(code);
}

// The workload supervisor this server starts (supervisorBinary.ts). The
// compiled binary carries it inside itself (`bun build --compile` is given
// the file); run from source, it is the one scripts/supervisor.ts built.
async function readSupervisor(): Promise<Uint8Array> {
    const embedded = ((globalThis as { Bun?: { embeddedFiles?: Array<Blob & { name: string }> } }).Bun?.embeddedFiles ?? [])
        .find((file) => file.name.startsWith("paperboard-supervisor"));
    if (embedded) return new Uint8Array(await embedded.arrayBuffer());
    const built = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "resources", "supervisor", `${process.platform}-${process.arch}`,
        process.platform === "win32" ? "paperboard-supervisor.exe" : "paperboard-supervisor");
    try {
        return await fs.promises.readFile(built);
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
        throw new Error("This Paperboard Server was built without its workload supervisor, so it cannot start anything. Build it with `bun scripts/supervisor.ts`, and compile the server with the built file beside main.ts.");
    }
}

async function main(): Promise<void> {
    setSupervisorBinary(readSupervisor);
    // a wrong command line was printed with its usage; nothing starts
    let command;
    try {
        command = parseCli(process.argv);
    } catch (err) {
        if (err instanceof CliHandledExit || err instanceof CliUsageError) process.exit(err.exitCode);
        throw err;
    }
    switch (command.kind) {
        // Compiled-binary service mode: the daemon re-invokes itself to run
        // an installed panel's service module in its own process, so a
        // remote needs no separate Node/Bun. The parent daemon owns this
        // child (kill by PID). No server is started here; the service opens
        // its own socket and exits when the daemon stops it.
        case "panel-service":
            await import(pathToFileURL(command.module).href);
            return;
        case "status": {
            const { runStatus } = await import("./localControl");
            return finish(() => runStatus(command.json));
        }
        case "pair": {
            const { runPair } = await import("./localControl");
            return finish(runPair);
        }
        case "install-service": {
            const { installService } = await import("./serviceInstall");
            return finish(() => installService(command));
        }
        case "uninstall-service": {
            const { uninstallService } = await import("./serviceInstall");
            return finish(() => uninstallService(command.target));
        }
        case "serve":
            await startPaperCraneServer(command.options);
            return;
    }
}

const isMainEntry = (import.meta as unknown as { main?: boolean }).main;
if (isMainEntry === true && !(process as any).versions?.electron) {
    main().catch(fatalCliError);
}
