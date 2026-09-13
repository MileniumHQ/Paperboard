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
import { parseCliArgs, startPaperCraneServer } from "./index";
import { logger } from "./logger";
import { getPaperboardDir } from "./paths";

// clean one-line startup failures instead of raw stacks
function fatalCliError(err: any): never {
    const msg = err?.message || String(err);
    if (err?.code === "EADDRINUSE") {
        console.error(`[PaperCrane] Port is already in use — another crane is running, or pass --port <n>.`);
    } else if (/EACCES|EPERM|permission/i.test(msg)) {
        console.error(`[PaperCrane] Cannot start: ${msg}`);
        console.error(`[PaperCrane] Check the data directory is writable (PAPERBOARD_DIR=${getPaperboardDir()}).`);
    } else {
        console.error(`[PaperCrane] Failed to start: ${msg}`);
    }
    process.exit(1);
}

async function main(): Promise<void> {
    let cliOptions;
    try {
        cliOptions = parseCliArgs();
    } catch (err) {
        logger.debug("[PaperCrane] CLI parse failed, starting with defaults:", err);
        cliOptions = {};
    }
    const supervise = (cliOptions as { supervise?: unknown }).supervise;
    if (typeof supervise === "string" && supervise) {
        const { runSupervisor } = await import("./supervisor");
        await runSupervisor(supervise);
        return;
    }
    await startPaperCraneServer(cliOptions);
}

const isMainEntry = (import.meta as unknown as { main?: boolean }).main;
if (isMainEntry === true && !(process as any).versions?.electron) {
    main().catch(fatalCliError);
}
