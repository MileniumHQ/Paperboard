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
import { pathToFileURL } from "url";
import { startPaperCraneServer } from "./index";
import { CliHandledExit, CliUsageError, EXIT, parseCli } from "./cli";
import { consoleRelayArgs, runConsoleRelay } from "./consoleRelay";
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

async function main(): Promise<void> {
    // a supervisor's console relay (consoleRelay.ts): its arguments are the
    // program's, so they never reach the option parser
    const relay = consoleRelayArgs(process.argv);
    if (relay) {
        runConsoleRelay(relay.command, relay.args);
        return;
    }
    // a wrong command line was printed with its usage; nothing starts
    let command;
    try {
        command = parseCli(process.argv);
    } catch (err) {
        if (err instanceof CliHandledExit || err instanceof CliUsageError) process.exit(err.exitCode);
        throw err;
    }
    switch (command.kind) {
        case "supervise": {
            const { runSupervisor } = await import("./supervisor");
            await runSupervisor(command.procId);
            return;
        }
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
